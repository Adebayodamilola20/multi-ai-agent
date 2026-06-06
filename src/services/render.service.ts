import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { RenderServiceInfo, RenderDeployInfo } from '../types';

const logger = createAgentLogger('render-service');

export class RenderService {
  private readonly baseUrl = 'https://api.render.com/v1';
  private readonly headers: Record<string, string>;

  constructor() {
    this.headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${config.render.apiKey}`
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!config.render.apiKey) {
      throw new Error('RENDER_API_KEY not configured');
    }
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Render API ${response.status}: ${text}`);
    }
    return response.json() as Promise<T>;
  }

  async getServices(): Promise<RenderServiceInfo[]> {
    const data = await this.request<{ services: RenderServiceInfo[] }>('GET', '/services');
    return data.services || [];
  }

  async getService(serviceId: string): Promise<RenderServiceInfo> {
    return this.request<RenderServiceInfo>('GET', `/services/${serviceId}`);
  }

  async getDeploys(serviceId: string, limit = 5): Promise<RenderDeployInfo[]> {
    const data = await this.request<{ deploys: RenderDeployInfo[] }>('GET', `/services/${serviceId}/deploys?limit=${limit}`);
    return data.deploys || [];
  }

  async getLatestDeploy(serviceId: string): Promise<RenderDeployInfo | null> {
    const deploys = await this.getDeploys(serviceId, 1);
    return deploys[0] || null;
  }

  async triggerDeploy(serviceId: string): Promise<RenderDeployInfo> {
    return this.request<RenderDeployInfo>('POST', `/services/${serviceId}/deploys`);
  }

  async getEnvVars(serviceId: string): Promise<Array<{ key: string; value: string }>> {
    return this.request<Array<{ key: string; value: string }>>('GET', `/services/${serviceId}/env-vars`);
  }

  async checkAllServices(): Promise<string> {
    const services = await this.getServices();
    if (services.length === 0) return 'No Render services found.';

    const lines: string[] = [];
    for (const svc of services) {
      const latest = await this.getLatestDeploy(svc.id);
      const status = latest?.status || 'unknown';
      const icon = status === 'live' ? '✅' : status === 'build_failed' || status === 'update_failed' ? '❌' : '⚠️';
      const url = svc.serviceDetails?.url ? `(${svc.serviceDetails.url})` : '';
      lines.push(`${icon} **${svc.name}** — ${status} ${url}`);
    }
    return lines.join('\n');
  }

  async getServiceLogs(serviceId: string, limit = 50): Promise<string> {
    try {
      const response = await fetch(
        `${this.baseUrl}/services/${serviceId}/logs?limit=${limit}&tail=true`,
        { headers: this.headers }
      );
      if (!response.ok) return `Failed to fetch logs (${response.status})`;
      const text = await response.text();
      return text.slice(0, 4000) || 'No logs available.';
    } catch (error) {
      return `Log fetch failed: ${(error as Error).message}`;
    }
  }
}

export const renderService = new RenderService();
