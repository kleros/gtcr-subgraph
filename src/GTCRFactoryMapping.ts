import { log } from '@graphprotocol/graph-ts';
import { GTCRFactory, NewGTCR } from '../generated/GTCRFactory/GTCRFactory';

export function handleNewGTCR(event: NewGTCR): void {
  log.info('GTCR: New instance deployed at {}', [event.address.toHexString()])
}
