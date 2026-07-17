export function buildWindowsBridgeEnvironment(
  sourceEnvironment: NodeJS.ProcessEnv,
  values: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const bridgeNames = Object.keys(values);
  const wslenv = [sourceEnvironment.WSLENV, ...bridgeNames].filter(Boolean).join(":");
  return {
    ...sourceEnvironment,
    ...values,
    WSLENV: wslenv,
  };
}
