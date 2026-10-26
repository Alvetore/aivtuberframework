import type { Snapshot } from '../../shared/product';
/** Sequence numbers are comparable only within one server process. */
export function mergeSnapshot(current:Snapshot|null,incoming:Snapshot):Snapshot {
  if(current?.serverInstanceId===incoming.serverInstanceId && incoming.seq<current.seq) return current;
  return incoming;
}
