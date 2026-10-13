import { digitsOnly, type RemoteInvoice } from "./dnb-invoice.ts";

export type UnimicroConfig = {
  apiBase: string;
  accessToken: string;
  companyKey: string;
  paymentInfoTypeId?: number;
};

export function unimicroConfigFromEnv(env: Record<string, string | undefined>): UnimicroConfig | null {
  const apiBase = env.UNIMICRO_API_BASE?.trim().replace(/\/$/, "");
  const accessToken = env.UNIMICRO_ACCESS_TOKEN?.trim();
  const companyKey = env.UNIMICRO_COMPANY_KEY?.trim();
  if (!apiBase || !accessToken || !companyKey) return null;
  const payment = env.UNIMICRO_PAYMENT_INFO_TYPE_ID?.trim();
  const paymentInfoTypeId = payment ? Number.parseInt(payment, 10) : undefined;
  return {
    apiBase,
    accessToken,
    companyKey,
    ...(Number.isInteger(paymentInfoTypeId) ? { paymentInfoTypeId } : {}),
  };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function headers(config: UnimicroConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.accessToken}`,
    CompanyKey: config.companyKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function asList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { Data?: unknown }).Data)) {
    return ((payload as { Data: unknown[] }).Data).filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  }
  return [];
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function remoteInvoiceFromPayload(payload: unknown): RemoteInvoice | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = typeof record.ID === "number" ? record.ID : Number(record.ID);
  const statusCode = typeof record.StatusCode === "number" ? record.StatusCode : Number(record.StatusCode);
  if (!Number.isInteger(id) || !Number.isInteger(statusCode)) return null;
  const rest = typeof record.RestAmount === "number" ? record.RestAmount : null;
  const total = typeof record.TaxInclusiveAmount === "number" ? record.TaxInclusiveAmount : null;
  return {
    id,
    statusCode,
    invoiceNumber: text(record.InvoiceNumber),
    credited: record.Credited === true,
    restAmount: rest,
    totalAmount: total,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

export function unimicroGateway(config: UnimicroConfig, fetchImpl: FetchLike = fetch) {
  async function get(path: string): Promise<unknown> {
    const response = await fetchImpl(`${config.apiBase}${path}`, { headers: headers(config) });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(typeof payload === "string" ? payload : `Unimicro ${response.status}`);
    }
    return payload;
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    const response = await fetchImpl(`${config.apiBase}${path}`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const message = typeof payload === "string" ? payload : JSON.stringify(payload);
      throw new Error(message || `Unimicro ${response.status}`);
    }
    return payload;
  }

  return {
    config,
    async findInvoiceByReference(reference: string): Promise<RemoteInvoice | null> {
      const filter = encodeURIComponent(`OurReference eq '${reference.replaceAll("'", "")}'`);
      const payload = await get(
        `/api/biz/invoices?filter=${filter}&select=ID,StatusCode,InvoiceNumber,RestAmount,TaxInclusiveAmount,Credited`,
      );
      const first = asList(payload)[0];
      return first ? remoteInvoiceFromPayload(first) : null;
    },
    async findCustomersByOrg(organizationNumber: string): Promise<{ id: number }[]> {
      const org = digitsOnly(organizationNumber);
      const filter = encodeURIComponent(`OrgNumber eq '${org}'`);
      const payload = await get(`/api/biz/customers?filter=${filter}&select=ID,OrgNumber`);
      return asList(payload).flatMap((row) => {
        const id = typeof row.ID === "number" ? row.ID : Number(row.ID);
        return Number.isInteger(id) ? [{ id }] : [];
      });
    },
    async createCustomer(input: { organizationNumber: string; name: string }): Promise<{ id: number }> {
      const payload = await post("/api/biz/customers", {
        OrgNumber: digitsOnly(input.organizationNumber),
        Info: { Name: input.name },
      });
      const created = remoteId(payload);
      if (created == null) throw new Error("Unimicro customer response had no ID");
      return { id: created };
    },
    async findNoSendPlans(): Promise<{ id: number; name: string }[]> {
      const filter = encodeURIComponent("EntityType eq 'Models.Sales.CustomerInvoice'");
      const payload = await get(`/api/biz/distributions?filter=${filter}`);
      return asList(payload).flatMap((row) => {
        const id = typeof row.ID === "number" ? row.ID : Number(row.ID);
        const name = text(row.Name);
        return Number.isInteger(id) && name ? [{ id, name }] : [];
      });
    },
    async createDraft(body: unknown): Promise<RemoteInvoice> {
      const payload = await post("/api/biz/invoices", body);
      const invoice = remoteInvoiceFromPayload(payload);
      if (!invoice) throw new Error("Unimicro invoice response had no ID");
      return invoice;
    },
  };
}

function remoteId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { ID?: unknown }).ID;
  const parsed = typeof id === "number" ? id : Number(id);
  return Number.isInteger(parsed) ? parsed : null;
}
