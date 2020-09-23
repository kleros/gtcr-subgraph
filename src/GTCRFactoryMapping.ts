import { log } from '@graphprotocol/graph-ts';
import { NewGTCR } from '../generated/GTCRFactory/GTCRFactory';
import { GeneralizedTCR } from '../generated/templates'

export function handleNewGTCR(event: NewGTCR): void {
  log.info('GTCR: New instance deployed at {}', [event.address.toHexString()])
  GeneralizedTCR.create(event.params._address);
}
