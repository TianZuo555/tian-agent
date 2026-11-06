import { Scroll, View } from 'nsh';
import { Button, Slider, Switch } from 'nsh/base';
import { Icon } from './ui';
import {
  ambientLight,
  captureSuggest,
  chatSize,
  codeWrap,
  followSystem,
  glass,
  look,
  reduceMotion,
} from './state';
import type { SettingsPage } from './state';
import { palette } from './theme';
import {
  copy,
  connection,
  drafts,
  imageDownscale,
  language,
  model,
  navigation,
  notice,
  notificationPrefs,
  thinking,
  shareOpen,
  type MobileKey,
} from './mobile-state';
import { Action, Heading, Label, Section, Surface } from './MobileUI';

const pageKeys: Record<SettingsPage, MobileKey> = {
  appearance: 'appearance',
  general: 'general',
  capture: 'capture',
  notify: 'notifications',
  model: 'model',
  providers: 'providers',
  workers: 'workers',
  skills: 'skills',
  server: 'server',
  channels: 'channels',
  usage: 'usage',
  improve: 'improvements',
};
const bands: { key: MobileKey; pages: SettingsPage[] }[] = [
  { key: 'agentBand', pages: ['model', 'providers', 'workers', 'skills'] },
  {
    key: 'personalBand',
    pages: ['general', 'appearance', 'capture', 'notify'],
  },
  { key: 'opsBand', pages: ['server', 'channels', 'usage', 'improve'] },
];
export function MobileSettings() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette(look()).winSolid,
        backgroundImage: palette(look()).inside,
      }}
    >
      <Heading title={copy('settings')} />
      <Scroll
        style={{ flex: 1 }}
        contentStyle={{ padding: 20, paddingBottom: 60, gap: 8 }}
      >
        {bands.map((band) => (
          <View>
            <Section>{copy(band.key)}</Section>
            <Surface style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
              {band.pages.map((id, index) => (
                <Button
                  accessibilityLabel={copy(pageKeys[id])}
                  onPress={() => navigation.push({ page: 'setting', id })}
                  style={{
                    minHeight: 52,
                    paddingHorizontal: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderBottomWidth: index === band.pages.length - 1 ? 0 : 1,
                    borderBottomColor: palette(look()).line,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Label>{copy(pageKeys[id])}</Label>
                  </View>
                  <Icon name="chevronRight" size={16} />
                </Button>
              ))}
            </Surface>
          </View>
        ))}
        <Label mono secondary size={9}>
          {copy('preview')}
        </Label>
      </Scroll>
    </View>
  );
}
function ToggleRow(props: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Label>{props.label}</Label>
      </View>
      <Switch
        accessibilityLabel={props.label}
        checked={props.value}
        onChange={(e) => props.onChange(e.checked)}
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: props.value
            ? palette(look()).bubble
            : palette(look()).line2,
          padding: 3,
        }}
        thumbStyle={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: props.value
            ? palette(look()).bubbleText
            : palette(look()).text2,
        }}
      />
    </View>
  );
}
function RangeRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={{ gap: 8, paddingVertical: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Label>{props.label}</Label>
        <Label mono secondary>
          {props.value}
        </Label>
      </View>
      <Slider
        accessibilityLabel={props.label}
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        onChange={(e) => {
          if (typeof e.value === 'number') props.onChange(e.value);
        }}
        style={{ minHeight: 44, justifyContent: 'center' }}
        trackStyle={{
          height: 4,
          borderRadius: 2,
          backgroundColor: palette(look()).line2,
        }}
        indicatorStyle={{ backgroundColor: palette(look()).text2 }}
        thumbStyle={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: palette(look()).text,
        }}
      />
    </View>
  );
}
export function MobileSetting(props: { id: SettingsPage }) {
  const id = props.id;
  const informational: Partial<Record<SettingsPage, MobileKey>> = {
    providers: 'providerInfo',
    workers: 'workerInfo',
    skills: 'skillInfo',
    channels: 'channelInfo',
    usage: 'usageInfo',
    improve: 'improvementInfo',
  };
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette(look()).winSolid,
        backgroundImage: palette(look()).inside,
      }}
    >
      <Heading title={copy(pageKeys[id])} />
      <Scroll
        style={{ flex: 1 }}
        contentStyle={{ padding: 20, paddingBottom: 80, gap: 20 }}
      >
        <If when={id === 'appearance'}>
          <Section>{copy('theme')}</Section>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['system', 'night', 'day'] as const).map((theme) => (
              <Action
                label={`${theme === (followSystem() ? 'system' : look()) ? '✓ ' : ''}${copy(theme)}`}
                onPress={() => {
                  followSystem.set(theme === 'system');
                  if (theme !== 'system') look.set(theme);
                }}
              />
            ))}
          </View>
          <Surface>
            <RangeRow
              label={copy('glass')}
              value={glass()}
              min={0}
              max={100}
              onChange={glass.set}
            />
            <ToggleRow
              label={copy('ambient')}
              value={ambientLight()}
              onChange={ambientLight.set}
            />
            <ToggleRow
              label={copy('motion')}
              value={reduceMotion()}
              onChange={reduceMotion.set}
            />
            <RangeRow
              label={copy('textSize')}
              value={chatSize()}
              min={12}
              max={22}
              onChange={chatSize.set}
            />
            <ToggleRow
              label={copy('codeWrap')}
              value={codeWrap()}
              onChange={codeWrap.set}
            />
          </Surface>
          <Label secondary size={12}>
            {copy('deviceOnly')}
          </Label>
        </If>
        <If when={id === 'general'}>
          <Section>{copy('language')}</Section>
          <Surface>
            {(['en', 'zh'] as const).map((locale) => (
              <Action
                label={`${language() === locale ? '✓ ' : ''}${copy(locale === 'en' ? 'english' : 'chinese')}`}
                onPress={() => language.set(locale)}
              />
            ))}
            <Label secondary size={12}>
              {copy('draftHint')}
            </Label>
            <Action
              label={copy('clearCache')}
              onPress={() => {
                drafts.set({ chief: '', atlas: '', juno: '', vega: '' });
                notice.set(copy('cleared'));
              }}
            />
          </Surface>
        </If>
        <If when={id === 'capture'}>
          <Label secondary>{copy('captureInfo')}</Label>
          <Surface>
            <ToggleRow
              label={copy('captureSuggestion')}
              value={captureSuggest()}
              onChange={captureSuggest.set}
            />
            <ToggleRow
              label={copy('downscale')}
              value={imageDownscale()}
              onChange={imageDownscale.set}
            />
          </Surface>
          <Action
            label={copy('share')}
            icon="camera"
            onPress={() => {
              navigation.popToRoot();
              shareOpen.set(true);
            }}
          />
        </If>
        <If when={id === 'notify'}>
          <Surface>
            {(['waiting', 'failed', 'done'] as const).map((key) => (
              <ToggleRow
                label={copy(
                  key === 'waiting'
                    ? 'waitingNotify'
                    : key === 'failed'
                      ? 'failedNotify'
                      : 'doneNotify',
                )}
                value={notificationPrefs()[key]}
                onChange={(value) =>
                  notificationPrefs.update((prefs) => ({
                    ...prefs,
                    [key]: value,
                  }))
                }
              />
            ))}
          </Surface>
          <Label secondary>{copy('workingNotify')}</Label>
          <Label secondary size={12}>
            {copy('accountSettings')}
          </Label>
        </If>
        <If when={id === 'model'}>
          <Label secondary>{copy('modelHint')}</Label>
          <Surface>
            {['claude-opus-4', 'claude-sonnet-4', 'gpt-5'].map((value) => (
              <Action
                label={`${model() === value ? '✓ ' : ''}${value}`}
                onPress={() => model.set(value)}
              />
            ))}
          </Surface>
          <Section>{copy('thinking')}</Section>
          <Surface>
            {(['low', 'medium', 'high'] as const).map((value) => (
              <Action
                label={`${thinking() === value ? '✓ ' : ''}${copy(value)}`}
                onPress={() => thinking.set(value)}
              />
            ))}
          </Surface>
        </If>
        <If when={id === 'server'}>
          <Surface>
            <Label>{copy('serverInfo')}</Label>
            <Label secondary>{copy('connectedDevices')}</Label>
          </Surface>
          <Label secondary>{copy('serverBoundary')}</Label>
          <Section>{copy('status')}</Section>
          {(['online', 'syncing', 'reconnecting', 'offline'] as const).map(
            (value) => (
              <Action
                label={`${connection() === value ? '✓ ' : ''}${copy(value)}`}
                onPress={() => connection.set(value)}
              />
            ),
          )}
          <Label mono secondary size={9}>
            {copy('preview')}
          </Label>
        </If>
        <If when={!!informational[id]}>
          <Surface>
            <Label>{copy(informational[id]!)}</Label>
          </Surface>
          <Label secondary>{copy('accountSettings')}</Label>
        </If>
      </Scroll>
    </View>
  );
}
