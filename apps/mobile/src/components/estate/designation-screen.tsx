import {
  ESTATE_METHOD_LABELS,
  isTrust,
  methodNamesPeople,
  type EstateCategory,
  type EstateMethod,
  type EstateTarget,
} from '@meld/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { BeneficiariesEditor, parseBeneficiaries, toBeneficiaryDrafts } from '@/components/beneficiaries-editor';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, formStyles, Input, parseDate } from '@/components/form-fields';
import { PlaidLinkButton } from '@/components/plaid-link-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { formatWholeCurrency } from '@/lib/format';
import { useBankNumber, useEstate, useSaveDesignation } from '@/lib/queries';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/plan?tab=estate'));
const today = () => new Date().toLocaleDateString('en-CA');

const METHODS: Record<EstateCategory, EstateMethod[]> = {
  retirement: ['beneficiary', 'trust', 'none'],
  hsa: ['beneficiary', 'trust', 'none'],
  education: ['beneficiary', 'trust', 'none'],
  custodial: ['none'],
  taxable: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  bank: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  property: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  vehicle: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  other: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  life: ['beneficiary', 'none'],
  debt: ['none'],
};

const HINTS: Partial<Record<EstateCategory, string>> = {
  retirement:
    'The beneficiary form on file with the plan or custodian decides who inherits, whatever your will says. Check it on their website, then record it here.',
  hsa: 'A spouse named as beneficiary keeps it as their own HSA; anyone else receives it as taxable income.',
  education: 'Name a successor owner with the plan so the account doesn’t go through probate. The student beneficiary stays the same.',
  bank: 'Most banks let you add a payable-on-death (POD) beneficiary online or with a short form.',
  taxable: 'Most brokerages let you add a transfer-on-death (TOD) beneficiary online.',
  property: 'Real estate usually passes by your trust, joint title with survivorship, or a transfer-on-death deed where your state allows one.',
  custodial: 'A custodial account already belongs to the child. Name a successor custodian with the institution.',
  debt: 'Debts are paid from your estate before anything is distributed. Nothing to set up; it’s listed in the packet.',
};

const methodLabel = (m: EstateMethod, category: EstateCategory) =>
  m === 'beneficiary' && category === 'education'
    ? 'Successor owner'
    : m === 'tod_pod' && category === 'property'
      ? 'Transfer-on-death deed'
      : ESTATE_METHOD_LABELS[m];

/** Records how an account or manual asset passes on death. */
export function DesignationScreen({ id }: { id: string }) {
  const estate = useEstate();
  const target = estate.data?.targets.find((t) => t.id === id);
  const back = (
    <Pressable onPress={goBack}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );
  if (!target) {
    return (
      <Screen title="On death" actions={back}>
        <ThemedText themeColor={estate.isError ? 'negative' : 'textSecondary'}>
          {estate.isPending ? 'Loading…' : estate.isError ? estate.error.message : 'This account isn’t in your totals, so it isn’t listed.'}
        </ThemedText>
      </Screen>
    );
  }
  return (
    <Screen title={target.name} actions={back}>
      <DesignationForm target={target} trusts={estate.data!.documents.filter((d) => isTrust(d.kind))} />
    </Screen>
  );
}

function DesignationForm({ target: t, trusts }: { target: EstateTarget; trusts: { id: string; name: string }[] }) {
  const save = useSaveDesignation();
  const methods = METHODS[t.category];
  const [method, setMethod] = useState<EstateMethod>(methods.includes(t.method) ? t.method : methods[0]!);
  const [beneficiaries, setBeneficiaries] = useState(toBeneficiaryDrafts(t.beneficiaries));
  const [trustId, setTrustId] = useState(t.trustId ?? trusts[0]?.id ?? null);
  const [notes, setNotes] = useState(t.notes ?? '');
  const [reviewedAt, setReviewedAt] = useState(t.reviewedAt ?? '');
  // Never sent back by the server; blank keeps the saved one.
  const [accountNumber, setAccountNumber] = useState('');
  const [savedLast4, setSavedLast4] = useState(t.accountNumberLast4);
  const bank = useBankNumber();
  const [bankMessage, setBankMessage] = useState<string | null>(null);
  const [consentItem, setConsentItem] = useState<string | null>(null);

  function fetchFromBank() {
    setBankMessage(null);
    setConsentItem(null);
    bank.mutate(t.id, {
      onSuccess: (r) => {
        if (r.status === 'ok') setAccountNumber(r.accountNumber);
        else if (r.status === 'consent_required') setConsentItem(r.itemId);
        else setBankMessage(r.message);
      },
      onError: (e) => setBankMessage(e.message),
    });
  }

  const people = methodNamesPeople(method);
  const parsed = parseBeneficiaries(beneficiaries);
  const reviewed = parseDate(reviewedAt);
  const number = accountNumber.trim();
  const numberValid = !number || /^[A-Za-z0-9][A-Za-z0-9 -]{2,38}[A-Za-z0-9]$/.test(number);
  const valid =
    (!people || parsed.every(Boolean)) && (method !== 'trust' || trustId !== null) && reviewed !== undefined && numberValid;

  function submit() {
    if (!valid) return;
    save.mutate(
      {
        accountId: t.kind === 'account' ? t.id : null,
        manualAssetId: t.kind === 'asset' ? t.id : null,
        method,
        beneficiaries: people ? parsed.filter((b) => b !== null) : [],
        trustId: method === 'trust' ? trustId : null,
        reviewedAt: reviewed ?? null,
        notes: notes.trim() || null,
        ...(number ? { accountNumber: number } : savedLast4 !== t.accountNumberLast4 && { accountNumber: null }),
      },
      { onSuccess: goBack },
    );
  }

  return (
    <>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {[t.detail, t.value !== null && formatWholeCurrency(t.value)].filter(Boolean).join(' · ')}
        </ThemedText>
        {HINTS[t.category] && <ThemedText type="small">{HINTS[t.category]}</ThemedText>}
      </Card>

      {methods.length > 1 && (
        <Card title="How it passes">
          <View style={formStyles.chips}>
            {methods.map((m) => (
              <Chip key={m} label={methodLabel(m, t.category)} selected={method === m} onPress={() => setMethod(m)} />
            ))}
          </View>
          {method === 'trust' &&
            (trusts.length ? (
              <View style={formStyles.chips}>
                {trusts.map((tr) => (
                  <Chip key={tr.id} label={tr.name} selected={trustId === tr.id} onPress={() => setTrustId(tr.id)} />
                ))}
              </View>
            ) : (
              <ThemedText type="small" themeColor="warning">
                Add your trust under Plan → Estate → Documents first.
              </ThemedText>
            ))}
          {method === 'joint_survivorship' && (
            <ThemedText type="small" themeColor="textSecondary">
              It passes to the surviving owner. Once they inherit it, their own beneficiaries decide what happens next.
            </ThemedText>
          )}
          {method === 'will' && (
            <ThemedText type="small" themeColor="textSecondary">
              It goes through probate, which is public and can take months.
            </ThemedText>
          )}
        </Card>
      )}

      {people && (
        <BeneficiariesEditor
          value={beneficiaries}
          onChange={setBeneficiaries}
          title={t.category === 'education' ? 'Successor owner' : 'Beneficiaries'}
          subtitle="As the institution has them on file. Contingent beneficiaries inherit if no primary beneficiary survives you."
        />
      )}

      {(t.kind === 'account' || t.category === 'other') && (
        <Card title="Account number">
          <Field label="Full account number" invalid={!numberValid}>
            <Input
              value={accountNumber}
              onChangeText={setAccountNumber}
              placeholder={savedLast4 ? `Saved, ending ${savedLast4}. Type to replace` : 'As on your statement'}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </Field>
          <View style={formStyles.buttons}>
            {t.numberFromBank && !consentItem && (
              <Button label="Get from bank" variant="secondary" size="small" loading={bank.isPending} onPress={fetchFromBank} />
            )}
            {savedLast4 && !number && (
              <Button label="Remove saved number" variant="secondary" size="small" onPress={() => setSavedLast4(null)} />
            )}
          </View>
          {consentItem && (
            <>
              <ThemedText type="small">
                Your bank connection doesn’t share account numbers yet. Reconnect it and allow account and routing numbers,
                then Meld fetches it.
              </ThemedText>
              <PlaidLinkButton
                itemId={consentItem}
                consentAuth
                label="Allow account numbers"
                size="small"
                onLinked={fetchFromBank}
                onError={setBankMessage}
              />
            </>
          )}
          {bankMessage && (
            <ThemedText type="small" themeColor="warning">
              {bankMessage}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            Printed in the family packet so your executor can tell the institution which account. Stored encrypted and
            never sent to Ask Meld.{t.numberFromBank ? ' Getting it from the bank uses Plaid Auth, which Plaid bills once per bank connection.' : ''}
          </ThemedText>
        </Card>
      )}

      <Card title="Notes">
        <Input value={notes} onChangeText={setNotes} placeholder="Estate services phone number, where the form is, anything your executor should know…" multiline />
        <Field label="Last checked with the institution" invalid={reviewed === undefined}>
          <View style={formStyles.buttons}>
            <Input value={reviewedAt} onChangeText={setReviewedAt} placeholder="YYYY-MM-DD" style={{ width: 140 }} />
            <Button label="Today" variant="secondary" size="small" onPress={() => setReviewedAt(today())} />
          </View>
        </Field>
      </Card>

      {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
      <View style={formStyles.buttons}>
        <Button label="Save" disabled={!valid} loading={save.isPending} onPress={submit} />
        <Button label="Cancel" variant="secondary" onPress={goBack} />
      </View>
    </>
  );
}
