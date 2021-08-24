/* eslint-disable prefer-const */
import { BigInt } from '@graphprotocol/graph-ts';
import { NewGTCR } from '../generated/LightGTCRFactory/LightGTCRFactory';
import { MetaEvidence, Registry } from '../generated/schema';
import { LightGeneralizedTCR as LightGeneralizedTCRDataSource } from '../generated/templates';

export function handleNewGTCR(event: NewGTCR): void {
  LightGeneralizedTCRDataSource.create(event.params._address);

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
  registry.numberOfAbsent = BigInt.fromI32(0);
  registry.numberOfRegistered = BigInt.fromI32(0);
  registry.numberOfRegistrationRequested = BigInt.fromI32(0);
  registry.numberOfChallengedRegistrations = BigInt.fromI32(0);
  registry.numberOfChallengedClearing = BigInt.fromI32(0);
  registry.save();
}
