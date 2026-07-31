import { LocalVault } from "./local-vault";
import { NoTelemetry } from "./no-telemetry";
import { SshTunnel } from "./ssh-tunnel";

export type MotionComponent = "ssh-tunnel" | "local-vault" | "no-telemetry";

const REGISTRY: Record<MotionComponent, () => React.JSX.Element> = {
  "ssh-tunnel": SshTunnel,
  "local-vault": LocalVault,
  "no-telemetry": NoTelemetry,
};

export function MotionGraphic({ component }: { component: MotionComponent }) {
  const Component = REGISTRY[component];
  return <Component />;
}
