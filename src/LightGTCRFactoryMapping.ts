/* eslint-disable prefer-const */
import { Address, Bytes, log } from '@graphprotocol/graph-ts';
import { NewGTCR } from '../generated/LightGTCRFactory/LightGTCRFactory';
import { MetaEvidence, LRegistry } from '../generated/schema';
import { LightGeneralizedTCR as LightGeneralizedTCRDataSource } from '../generated/templates';
import { ZERO } from './utils';

export function createNewGTCR(address: Bytes):LRegistry {


 LightGeneralizedTCRDataSource.create(Address.fromBytes(address));

 let registry = new LRegistry(address.toHexString());

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

 return registry;
};

export function handleNewGTCR(event: NewGTCR): void {

    log.warning('Found Registry event : {}',[event.params._address.toHexString()]);
    createNewGTCR(event.params._address);
}
