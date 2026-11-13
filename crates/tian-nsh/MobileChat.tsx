import {
  Image,
  Picker,
  Scroll,
  signal,
  View,
  safeArea,
  keyboardFrame,
  type ScrollRef,
} from 'nsh';
import { Dialog, Input, Radio, RadioGroup } from 'nsh/base';
import { Avatar } from './Avatar';
import { palette } from './theme';
import { captureSuggest, chatSize, look } from './state';
import type { ConvId } from './state';
import { SANS } from './fonts';
import { MiniRail, Dot } from './ui';
import {
  Action,
  Floating,
  Heading,
  Label,
  Round,
  Section,
  Surface,
} from './MobileUI';
import {
  approval,
  attachments,
  connection,
  conversationModels,
  copy,
  drafts,
  imageDownscale,
  messages,
  migrationChoice,
  model,
  navigation,
  notice,
  openConversation,
  review,
  sendLocal,
  thinking,
  urls,
} from './mobile-state';

export function MobileChat(props: { id: ConvId }) {
  const id = props.id;
  const title =
    id === 'chief'
      ? 'Chief'
      : id === 'atlas'
        ? 'Atlas'
        : id === 'juno'
          ? 'Juno'
          : 'Vega';
  const config = () =>
    conversationModels()[id] ?? { model: model(), thinking: thinking() };
  const detailOpen = signal(false);
  const modelOpen = signal(false);
  const moreInfo = signal(false);
  let scroll: ScrollRef | undefined;
  const follow = signal(true);
  const inputHeight = signal(44);
  const addImage = async () => {
    try {
      const files = await Picker.pickImages({
        limit: 4,
        maxDimension: imageDownscale() ? 2560 : undefined,
      });
      const images = files.map((file) => {
        const uri = URL.createObjectURL(file.file);
        urls.add(uri);
        return { uri, name: file.file.name };
      });
      attachments.update((rows) => ({
        ...rows,
        [id]: [...rows[id], ...images],
      }));
    } catch {
      notice.set(copy('pickerError'));
    }
  };
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette(look()).winSolid,
        backgroundImage: palette(look()).inside,
      }}
    >
      <Heading
        title={title}
        identity={id}
        subtitle={copy(`${id}Presence`)}
        trailing={
          <Round
            label={copy('inspector')}
            icon="dots"
            onPress={() => detailOpen.set(true)}
          />
        }
      />
      <ConnectionBanner />
      <Scroll
        ref={(r) => {
          scroll = r;
        }}
        testID="mobile-thread"
        style={{ flex: 1 }}
        keyboardDismissMode="interactive"
        onScroll={(e) =>
          follow.set(e.contentSize.height - e.offset.y - e.size.height < 100)
        }
        contentStyle={{ padding: 20, paddingBottom: 220, gap: 20 }}
      >
        <Label mono secondary size={9}>
          {copy('preview')}
        </Label>
        <If when={id === 'chief'}>
          <Label serif size={28}>
            {copy('greeting')}
          </Label>
          <Prose>{copy('daily')}</Prose>
          <View
            style={{
              alignSelf: 'flex-end',
              maxWidth: '88%',
              borderRadius: 20,
              borderBottomRightRadius: 6,
              padding: 15,
              backgroundColor: palette(look()).bubble,
            }}
          >
            <Label color={palette(look()).bubbleText}>
              {copy('duplicate')}
            </Label>
          </View>
          <Prose>{copy('handoff')}</Prose>
          <Surface>
            <View
              style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}
            >
              <Avatar id="atlas" state="working" />
              <View style={{ flex: 1, gap: 4 }}>
                <Label mono size={9} secondary>
                  {copy('delegation')}
                </Label>
                <Label weight={600}>{copy('task')}</Label>
              </View>
            </View>
            <Action
              label={copy('openManager')}
              icon="arrowRight"
              onPress={() => openConversation('atlas')}
            />
          </Surface>
        </If>
        <If when={id === 'atlas'}>
          <Prose>{copy('atlasIntro')}</Prose>
        </If>
        <If when={id === 'chief' || id === 'atlas'}>
          <Surface>
            <Label weight={600}>{copy('runTitle')}</Label>
            <Label mono secondary size={10}>
              {copy('branch')}
            </Label>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between' }}
            >
              {[
                ['4', 'files'],
                ['128/128', 'tests'],
                ['2', 'attempts'],
              ].map(([value, key]) => (
                <View style={{ gap: 2 }}>
                  <Label weight={600} size={20}>
                    {value}
                  </Label>
                  <Label mono secondary size={9}>
                    {copy(key as 'files')}
                  </Label>
                </View>
              ))}
            </View>
            <Label secondary>
              {review() === 'pending'
                ? copy('review')
                : copy(
                    review() === 'landed'
                      ? 'landed'
                      : review() === 'shipped'
                        ? 'shipped'
                        : 'discarded',
                  )}
            </Label>
            <Action
              primary
              label={copy('viewChanges')}
              icon="branch"
              onPress={() => navigation.push({ page: 'diff' })}
            />
          </Surface>
          <RunCard number={13} stage={3} />
          <RunCard number={14} stage={1} />
        </If>
        <If when={id === 'juno'}>
          <Prose>{copy('approvalBody')}</Prose>
          <Surface style={{ borderColor: palette(look()).wait }}>
            <Label serif size={24}>
              {copy('approvalTitle')}
            </Label>
            <If when={approval() === 'pending'}>
              <RadioGroup style={{ gap: 12 }}>
                {(['online', 'offline'] as const).map((choice) => (
                  <Radio
                    accessibilityLabel={copy(
                      choice === 'online'
                        ? 'onlineMigration'
                        : 'offlineMigration',
                    )}
                    checked={migrationChoice() === choice}
                    onChange={() => migrationChoice.set(choice)}
                    style={{
                      padding: 12,
                      minHeight: 64,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor:
                        migrationChoice() === choice
                          ? palette(look()).wait
                          : palette(look()).line,
                    }}
                  >
                    <Label
                      weight={600}
                    >{`${migrationChoice() === choice ? '● ' : '○ '}${copy(choice === 'online' ? 'onlineMigration' : 'offlineMigration')}`}</Label>
                    <Label size={12} secondary>
                      {copy(
                        choice === 'online'
                          ? 'onlineConsequence'
                          : 'offlineConsequence',
                      )}
                    </Label>
                  </Radio>
                ))}
              </RadioGroup>
              <Action
                primary
                label={copy('approve')}
                onPress={() => approval.set('approved')}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Action
                  label={copy('askMore')}
                  onPress={() => moreInfo.set(!moreInfo())}
                />
                <Action
                  label={copy('reject')}
                  danger
                  onPress={() => approval.set('rejected')}
                />
              </View>
            </If>
            <If when={approval() !== 'pending'}>
              <Label>
                {copy(approval() === 'approved' ? 'approved' : 'rejected')}
              </Label>
            </If>
            <If when={moreInfo()}>
              <Prose>{copy('moreAnswer')}</Prose>
            </If>
          </Surface>
        </If>
        <If when={id === 'vega'}>
          <View style={{ alignItems: 'center', paddingVertical: 48, gap: 18 }}>
            <Avatar id="vega" state="sleeping" size={110} />
            <Label serif size={28}>
              {copy('emptyTitle')}
            </Label>
            <Prose>{copy('emptyBody')}</Prose>
          </View>
        </If>
        <Each of={messages()[id]} key={(message) => message.id}>
          {(message) => (
            <View
              onLayout={() => {
                if (follow()) scroll?.scrollToEnd({ animated: false });
              }}
              style={{ gap: 8, alignItems: 'flex-end' }}
            >
              <Each of={message().images}>
                {(image) => (
                  <Image
                    src={image().uri}
                    accessibilityLabel={image().name}
                    style={{
                      width: 200,
                      height: 160,
                      borderRadius: 16,
                      objectFit: 'cover',
                    }}
                  />
                )}
              </Each>
              <If when={!!message().text}>
                <View
                  style={{
                    maxWidth: '88%',
                    padding: 15,
                    borderRadius: 20,
                    borderBottomRightRadius: 6,
                    backgroundColor: palette(look()).bubble,
                  }}
                >
                  <Label color={palette(look()).bubbleText}>
                    {message().text}
                  </Label>
                </View>
              </If>
              <Label mono size={9} secondary>
                {copy('sampleSent')}
              </Label>
            </View>
          )}
        </Each>
      </Scroll>
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 12,
          paddingTop: 20,
          paddingBottom: Math.max(
            safeArea().bottom,
            keyboardFrame().height,
            12,
          ),
          pointerEvents: 'box-none',
        }}
      >
        <Floating>
          <If when={attachments()[id].length > 0}>
            <Scroll
              horizontal
              style={{ maxHeight: 72 }}
              contentStyle={{ flexDirection: 'row', gap: 8 }}
            >
              <Each of={attachments()[id]}>
                {(image) => (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Image
                      src={image().uri}
                      accessibilityLabel={image().name}
                      style={{ width: 56, height: 56, borderRadius: 10 }}
                    />
                    <Round
                      label={copy('removeAttachment')}
                      icon="x"
                      onPress={() => {
                        attachments.update((rows) => ({
                          ...rows,
                          [id]: rows[id].filter(
                            (item) => item.uri !== image().uri,
                          ),
                        }));
                        URL.revokeObjectURL(image().uri);
                        urls.delete(image().uri);
                      }}
                    />
                  </View>
                )}
              </Each>
            </Scroll>
          </If>
          <If
            when={
              id === 'chief' && captureSuggest() && !attachments()[id].length
            }
          >
            <Label size={10} secondary>
              {copy('captureInfo')}
            </Label>
          </If>
          <View
            style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}
          >
            <Round
              label={copy('attach')}
              icon="plus"
              onPress={() => {
                void addImage();
              }}
            />
            <Input
              accessibilityLabel={copy('message')}
              value={drafts()[id]}
              onChange={(e) =>
                drafts.update((rows) => ({ ...rows, [id]: e.value }))
              }
              multiline
              submitBehavior="newline"
              placeholder={id === 'chief' ? copy('askChief') : `${title}…`}
              onContentSizeChange={(e) =>
                inputHeight.set(Math.min(120, Math.max(44, e.size.height)))
              }
              style={{
                flex: 1,
                height: inputHeight(),
                paddingVertical: 12,
                fontFamily: SANS,
                fontSize: 14,
                lineHeight: 22,
                color: palette(look()).text,
                placeholderColor: palette(look()).text3,
              }}
            />
            <Action
              compact
              primary
              icon="send"
              label={copy('send')}
              disabled={
                connection() !== 'online' ||
                (!drafts()[id].trim() && !attachments()[id].length)
              }
              onPress={() => {
                follow.set(true);
                sendLocal(id);
              }}
            />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 8,
            }}
          >
            <Action
              compact
              label={`${config().model} · ${copy(config().thinking)}`}
              onPress={() => modelOpen.set(true)}
            />
            <View style={{ flex: 1 }} />
            <Dot state={connection() === 'online' ? 'work' : 'fail'} />
          </View>
        </Floating>
      </View>
      <Dialog
        open={detailOpen()}
        presentation="pageSheet"
        onOpenChange={(e) => detailOpen.set(e.open)}
        style={{
          flex: 1,
          backgroundColor: palette(look()).winSolid,
          padding: 20,
          gap: 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Label serif size={26}>
            {copy('details')}
          </Label>
          <View style={{ flex: 1 }} />
          <Round
            label={copy('cancel')}
            icon="x"
            onPress={() => detailOpen.set(false)}
          />
        </View>
        <Avatar
          id={id}
          size={80}
          state={id === 'juno' ? 'waiting' : 'thinking'}
        />
        <Label size={22}>{title}</Label>
        <Label secondary>{copy(`${id}Presence`)}</Label>
        <If when={id === 'chief' || id === 'atlas'}>
          <Section>{copy('activeRuns')}</Section>
          <Label>{copy('runDetail')}</Label>
          <Action
            label={copy('viewChanges')}
            onPress={() => {
              detailOpen.set(false);
              navigation.push({ page: 'diff' });
            }}
          />
          <Section>{copy('tasks')}</Section>
          <Label>{copy('task')}</Label>
        </If>
        <If when={id === 'chief' || id === 'juno'}>
          <Label>{copy('migration')}</Label>
        </If>
        <If when={id === 'vega'}>
          <Label secondary>{copy('emptyBody')}</Label>
        </If>
        <Section>{copy('scope')}</Section>
        <Label>{copy(id === 'chief' ? 'global' : 'project')}</Label>
      </Dialog>
      <Dialog
        open={modelOpen()}
        presentation="pageSheet"
        onOpenChange={(e) => modelOpen.set(e.open)}
        style={{
          flex: 1,
          padding: 24,
          gap: 16,
          backgroundColor: palette(look()).winSolid,
        }}
      >
        <View style={{ flexDirection: 'row' }}>
          <Label serif size={28}>
            {copy('model')}
          </Label>
          <View style={{ flex: 1 }} />
          <Round
            label={copy('cancel')}
            icon="x"
            onPress={() => modelOpen.set(false)}
          />
        </View>
        <Label secondary>{copy('conversationOnly')}</Label>
        {['claude-opus-4', 'claude-sonnet-4', 'gpt-5'].map((value) => (
          <Action
            label={`${config().model === value ? '✓ ' : ''}${value}`}
            onPress={() =>
              conversationModels.update((rows) => ({
                ...rows,
                [id]: { ...config(), model: value },
              }))
            }
          />
        ))}
        <Section>{copy('thinking')}</Section>
        {(['low', 'medium', 'high'] as const).map((value) => (
          <Action
            label={`${config().thinking === value ? '✓ ' : ''}${copy(value)}`}
            onPress={() =>
              conversationModels.update((rows) => ({
                ...rows,
                [id]: { ...config(), thinking: value },
              }))
            }
          />
        ))}
      </Dialog>
    </View>
  );
}
function Prose(props: { children?: any }) {
  return <Label size={chatSize()}>{props.children}</Label>;
}
function RunCard(props: { number: 13 | 14; stage: number }) {
  const expanded = signal(false);
  return (
    <Surface>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Avatar
          id="atlas"
          state={props.stage === 3 ? 'verifying' : 'reading'}
          size={32}
        />
        <View style={{ flex: 1 }}>
          <Label weight={600}>
            {copy(props.number === 13 ? 'run13' : 'run14')}
          </Label>
        </View>
        <MiniRail stage={props.stage} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['understand', 'edit', 'verify', 'report'] as const).map(
          (key, index) => (
            <Label
              mono
              size={8}
              color={
                index === props.stage - 1
                  ? palette(look()).work
                  : palette(look()).text3
              }
            >
              {copy(key)}
            </Label>
          ),
        )}
      </View>
      <Label secondary size={12}>
        {copy(props.stage === 3 ? 'verifying' : 'understanding')}
      </Label>
      <Action
        label={`${expanded() ? '−' : '+'} ${copy('steps')}`}
        onPress={() => expanded.set(!expanded())}
      />
      <If when={expanded()}>
        <Label secondary size={12}>
          {copy('milestone')}
        </Label>
      </If>
    </Surface>
  );
}
export function ConnectionBanner() {
  return (
    <If when={connection() !== 'online'}>
      <View
        android={{ accessibilityLiveRegion: 'polite' }}
        style={{
          paddingHorizontal: 20,
          paddingVertical: 8,
          backgroundColor: palette(look()).card,
          borderBottomWidth: 1,
          borderBottomColor:
            connection() === 'offline'
              ? palette(look()).fail
              : palette(look()).wait,
        }}
      >
        <Label
          size={11}
          color={
            connection() === 'offline'
              ? palette(look()).fail
              : palette(look()).wait
          }
        >
          {copy(connection() === 'offline' ? 'nothingSent' : connection())}
        </Label>
      </View>
    </If>
  );
}
