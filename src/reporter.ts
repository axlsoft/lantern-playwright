export interface ReporterConfig {
  collectorUrl: string;
}

export class LanternReporter {
  constructor(private readonly config: ReporterConfig) {}

  async onBegin(): Promise<void> {
    void this.config.collectorUrl;
  }
}
