import type { AppCatalogService } from './app-catalog'

export class AppLauncher {
  constructor(private readonly catalog: AppCatalogService) {}

  async launchApp(id: string): Promise<void> {
    await this.catalog.launch(id)
  }
}
