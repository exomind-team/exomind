export async function bootstrapBeforeRender(
  bootstrap: () => Promise<void>,
  render: () => void,
  reportError: (error: unknown) => void = (error) => {
    console.warn('[bootstrap-before-render] bootstrap failed, fallback to render', error);
  },
): Promise<void> {
  try {
    await bootstrap();
  } catch (error) {
    reportError(error);
  }

  render();
}
