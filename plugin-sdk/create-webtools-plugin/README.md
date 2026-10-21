# create-webtools-plugin

Create an independent Manifest v3 WebTools plugin project.

```powershell
pnpm add --save-dev .\create-webtools-plugin-1.1.0.tgz
pnpm exec create-webtools-plugin my-plugin --framework vue --runtime web --yes
```

`create-webtools-plugin` is distributed as a standalone package tarball with the WebTools developer tools. The command above works before registry publication. Once the package is published to a registry, the shorter `pnpm create webtools-plugin` convention can be used.

Choose a Vanilla, Vue, React, or Svelte frontend and a Web or Node runtime. The generated project contains its own source, Vite configuration, Manifest, and build scripts; it has no imports from the WebTools repository.

The matching `@webtools/plugin-sdk` package is distributed as `webtools-plugin-sdk-1.6.0.tgz` with the WebTools developer tools. Install that local package in the generated project, then use `pnpm dev`, `pnpm build`, `pnpm validate`, and `pnpm run pack`. (`pnpm pack` creates a Node package tarball.) Web starters use the SDK only while building the frontend, so it remains a development dependency. Node starters import `@webtools/plugin-sdk/node` from their preload, so the template declares the SDK as a production dependency and the local tarball must be installed with `pnpm add --save-prod`. The generated Web entry imports the optional `@webtools/plugin-sdk/theme.css` token consumer; plugin authors can remove it and retain their own theme and page styling. The Host independently validates every package at install time.

The create package itself has no runtime dependencies. Its executable supports non-interactive use with `--framework`, `--runtime`, `--package-manager`, `--id`, `--name`, and `--yes`.
