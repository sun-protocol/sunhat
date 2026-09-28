/** Minimal state holder used to prove that managers are not shared by connections. */
export class ProbeManager {
  public counter = 0;

  public constructor(public readonly connectionId: number) {}
}
