/** The topmost mounted canvas owns animation; closing it resumes the prior one. */
export function createCameraDrivers() {
  const drivers: Array<() => void> = [];
  const isActive = (driver: () => void) => drivers.at(-1) === driver;
  const wake = () => drivers.at(-1)?.();
  return {
    isActive,
    wake,
    register(driver: () => void) {
      drivers.push(driver);
      wake();
      return () => {
        const wasActive = isActive(driver);
        const index = drivers.indexOf(driver);
        if (index >= 0) drivers.splice(index, 1);
        if (wasActive) wake();
      };
    },
  };
}
