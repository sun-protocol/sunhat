export async function withCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let result: T;
  try {
    result = await action();
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      try {
        console.error('TRON cleanup failed:', cleanupError);
      } catch {
        /* Preserve the primary thrown value. */
      }
    }
    throw error;
  }
  await cleanup();
  return result;
}
