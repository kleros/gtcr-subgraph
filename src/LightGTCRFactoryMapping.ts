/* eslint-disable prefer-const */
import { NewGTCR } from '../generated/LightGTCRFactory/LightGTCRFactory';
import { MetaEvidence, LRegistry } from '../generated/schema';
import { LightGeneralizedTCR as LightGeneralizedTCRDataSource } from '../generated/templates';
import { ZERO } from './utils';

export function handleNewGTCR(event: NewGTCR): void {
  LightGeneralizedTCRDataSource.create(event.params._address);

  let registry = new LRegistry(event.params._address.toHexString());

  let registrationMetaEvidence = new MetaEvidence(registry.id + '-1');
  registrationMetaEvidence.URI = '';
  registrationMetaEvidence.save();

  let clearingMetaEvidence = new MetaEvidence(registry.id + '-2');
  clearingMetaEvidence.URI = '';
  clearingMetaEvidence.save();

  registry.metaEvidenceCount = ZERO;
  registry.registrationMetaEvidence = registrationMetaEvidence.id;
  registry.clearingMetaEvidence = clearingMetaEvidence.id;
  registry.numberOfAbsent = ZERO;
  registry.numberOfRegistered = ZERO;
  registry.numberOfRegistrationRequested = ZERO;
  registry.numberOfClearingRequested = ZERO;
  registry.numberOfChallengedRegistrations = ZERO;
  registry.numberOfChallengedClearing = ZERO;
  registry.save();
}
