import { KEY_CONTACT_LABELS, KeyContactRole, type EstateSettings, type KeyContact } from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, formStyles, Input, Row } from '@/components/form-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSaveEstateSettings } from '@/lib/queries';

type ContactDraft = { role: KeyContactRole; name: string; relationship: string; phone: string; email: string };

const toDraft = (c: KeyContact): ContactDraft => ({
  role: c.role,
  name: c.name,
  relationship: c.relationship ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
});
const text = (s: string) => s.trim() || null;
const INTERVALS = [1, 2, 3, 5];

/** Who your family should call, where your logins are, and a note to them; all of it goes in the packet. */
export function ContactsCard({ settings }: { settings: EstateSettings }) {
  const theme = useTheme();
  const save = useSaveEstateSettings();
  const [contacts, setContacts] = useState<ContactDraft[]>(settings.contacts.map(toDraft));
  const [credentials, setCredentials] = useState(settings.credentialsNote ?? '');
  const [instructions, setInstructions] = useState(settings.instructions ?? '');
  const [interval, setInterval] = useState(settings.reviewIntervalYears);
  const [saved, setSaved] = useState(false);

  const update = (i: number, patch: Partial<ContactDraft>) => {
    setSaved(false);
    setContacts((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };
  const valid = contacts.every((c) => c.name.trim());

  function submit() {
    save.mutate(
      {
        contacts: contacts.map((c) => ({ role: c.role, name: c.name.trim(), relationship: text(c.relationship), phone: text(c.phone), email: text(c.email) })),
        credentialsNote: text(credentials),
        instructions: text(instructions),
        reviewIntervalYears: interval,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <Card
      title="Contacts and instructions"
      subtitle="Printed in the family packet. Meld never stores passwords; say where your family will find them instead."
      action={
        <Button
          label="Add contact"
          variant="secondary"
          size="small"
          onPress={() => {
            setSaved(false);
            setContacts((list) => [...list, { role: list.length ? 'other' : 'executor', name: '', relationship: '', phone: '', email: '' }]);
          }}
        />
      }>
      {contacts.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Add your executor or successor trustee, estate attorney, accountant, financial advisor and employer HR.
        </ThemedText>
      )}
      {contacts.map((c, i) => (
        <View key={i} style={[styles.contact, { borderColor: theme.border }]}>
          <View style={formStyles.chips}>
            {KeyContactRole.options.map((role) => (
              <Chip key={role} label={KEY_CONTACT_LABELS[role]} selected={c.role === role} onPress={() => update(i, { role })} />
            ))}
          </View>
          <Row>
            <Field label="Name" invalid={!c.name.trim()} flex>
              <Input value={c.name} onChangeText={(name) => update(i, { name })} />
            </Field>
            <Field label="Relationship or firm" flex>
              <Input value={c.relationship} onChangeText={(relationship) => update(i, { relationship })} />
            </Field>
          </Row>
          <Row>
            <Field label="Phone" flex>
              <Input value={c.phone} onChangeText={(phone) => update(i, { phone })} inputMode="tel" />
            </Field>
            <Field label="Email" flex>
              <Input value={c.email} onChangeText={(email) => update(i, { email })} inputMode="email" autoCapitalize="none" />
            </Field>
          </Row>
          <View style={formStyles.buttons}>
            <View style={formStyles.spacer} />
            <Button
              label="Remove"
              variant="secondary"
              size="small"
              onPress={() => {
                setSaved(false);
                setContacts((list) => list.filter((_, j) => j !== i));
              }}
            />
          </View>
        </View>
      ))}

      <Field label="Where to find logins and passwords">
        <Input
          value={credentials}
          onChangeText={(v) => (setSaved(false), setCredentials(v))}
          placeholder="e.g. 1Password family vault; the emergency kit is in the safe"
          multiline
        />
      </Field>
      <Field label="A note to your family">
        <Input
          value={instructions}
          onChangeText={(v) => (setSaved(false), setInstructions(v))}
          placeholder="Your wishes, what to do first, anything they should know…"
          multiline
          style={styles.letter}
        />
      </Field>
      <Field label="Remind me to review documents and beneficiaries every">
        <View style={formStyles.chips}>
          {INTERVALS.map((n) => (
            <Chip key={n} label={`${n} year${n === 1 ? '' : 's'}`} selected={interval === n} onPress={() => (setSaved(false), setInterval(n))} />
          ))}
        </View>
      </Field>

      {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
      <View style={formStyles.buttons}>
        <Button label="Save" disabled={!valid} loading={save.isPending} onPress={submit} />
        {saved && (
          <ThemedText type="small" themeColor="textSecondary">
            Saved.
          </ThemedText>
        )}
        {!valid && (
          <ThemedText type="small" themeColor="textSecondary">
            Give every contact a name to save.
          </ThemedText>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  contact: { gap: Spacing.two, paddingBottom: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  letter: { minHeight: 140 },
});
