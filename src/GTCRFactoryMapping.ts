/* eslint-disable prefer-const */
import { BigInt } from '@graphprotocol/graph-ts';
import { NewGTCR } from '../generated/GTCRFactory/GTCRFactory';
import { MetaEvidence, Registry } from '../generated/schema';
import { GeneralizedTCR as GeneralizedTCRDataSource } from '../generated/templates';

export function handleNewGTCR(event: NewGTCR): void {
  GeneralizedTCRDataSource.create(event.params._address);

  let registry = new Registry(event.params._address.toHexString());

  let registrationMetaEvidence = new MetaEvidence(registry.id + '-1');
  registrationMetaEvidence.URI = '';
  registrationMetaEvidence.save();

  let clearingMetaEvidence = new MetaEvidence(registry.id + '-2');
  clearingMetaEvidence.URI = '';
  clearingMetaEvidence.save();

  registry.metaEvidenceCount = BigInt.fromI32(0);
  registry.registrationMetaEvidence = registrationMetaEvidence.id;
  registry.clearingMetaEvidence = clearingMetaEvidence.id;
  registry.numberOfItems = BigInt.fromI32(0);
  registry.save();
}
