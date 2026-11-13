import { Image, Picker, Scroll, signal, View, safeArea } from 'nsh';
import { Button, Dialog, Input } from 'nsh/base';
import { Avatar } from './Avatar';
import { palette } from './theme';
import { ambientLight, look } from './state';
import type { ConvId } from './state';
import {
  copy,
  drafts,
  imageDownscale,
  navigation,
  notice,
  openConversation,
  attachments,
  approval,
  urls,
  shareOpen,
} from './mobile-state';
import {
  Action,
  Floating,
  Heading,
  Label,
  Round,
  Section,
  Surface,
} from './MobileUI';
import { Dot } from './ui';
import { SANS } from './fonts';

export function MobileHome() {
  const query = signal('');
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette(look()).winSolid,
        backgroundImage: palette(look()).inside,
      }}
    >
      <Heading
        title="Tian"
        back={false}
        trailing={
          <>
            <Round
              label={copy('share')}
              icon="camera"
              onPress={() => shareOpen.set(true)}
            />
            <Round
              label={copy('settings')}
              icon="gear"
              onPress={() => navigation.push({ page: 'settings' })}
            />
          </>
        }
      />
      <Scroll
        style={{ flex: 1 }}
        keyboardDismissMode="on-drag"
        contentStyle={{
          paddingHorizontal: 20,
          paddingTop: 24,
          paddingBottom: 150,
          gap: 10,
        }}
      >
        <View
          style={{
            position: 'relative',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 20,
          }}
        >
          <If when={ambientLight()}>
            <View
              style={{
                position: 'absolute',
                top: -80,
                left: -40,
                right: -40,
                height: 300,
                backgroundImage: `radial-gradient(circle at 40% 38%, ${palette(look()).sun}, transparent 70%)`,
                pointerEvents: 'none',
              }}
            />
          </If>
          <Label mono secondary size={10}>
            {copy('date')}
          </Label>
          <Label serif size={34}>
            {copy('hello')}
          </Label>
          <Button
            accessibilityLabel="Chief"
            onPress={() => openConversation('chief')}
            style={{ padding: 8 }}
          >
            <Avatar id="chief" size={128} state="thinking" />
          </Button>
          <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
            <Dot state="work" />
            <Label secondary size={11}>
              {copy('chiefStatus')}
            </Label>
          </View>
        </View>
        <Input
          accessibilityLabel={copy('search')}
          value={query()}
          onChange={(e) => query.set(e.value)}
          placeholder={copy('search')}
          style={{
            minHeight: 44,
            borderRadius: 14,
            paddingHorizontal: 14,
            fontFamily: SANS,
            fontSize: 13,
            backgroundColor: palette(look()).card,
            color: palette(look()).text,
            placeholderColor: palette(look()).text3,
          }}
        />
        <If when={!query() && approval() === 'pending'}>
          <Section>{copy('needsYou')}</Section>
          <Button
            accessibilityLabel={copy('junoNeeds')}
            onPress={() => openConversation('juno')}
          >
            <Surface>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <Avatar id="juno" size={48} state="waiting" />
                <View style={{ flex: 1, gap: 4 }}>
                  <Label weight={600}>{copy('junoNeeds')}</Label>
                  <Label size={11} secondary>
                    {copy('migration')}
                  </Label>
                </View>
                <Dot state="wait" />
              </View>
            </Surface>
          </Button>
        </If>
        <Section>{copy('projects')}</Section>
        {(['atlas', 'juno', 'vega'] as const).map((id) => (
          <If
            when={
              !query() ||
              `${id} ${projectName(id)}`
                .toLowerCase()
                .includes(query().toLowerCase())
            }
          >
            <Button
              accessibilityLabel={
                id === 'atlas' ? 'Atlas' : id === 'juno' ? 'Juno' : 'Vega'
              }
              onPress={() => openConversation(id)}
              style={{
                paddingVertical: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderBottomWidth: 1,
                borderBottomColor: palette(look()).line,
              }}
            >
              <Avatar
                id={id}
                size={48}
                state={
                  id === 'atlas'
                    ? 'working'
                    : id === 'juno'
                      ? 'waiting'
                      : 'sleeping'
                }
              />
              <View style={{ flex: 1, gap: 3 }}>
                <Label weight={600} size={16}>
                  {id === 'atlas' ? 'Atlas' : id === 'juno' ? 'Juno' : 'Vega'}
                </Label>
                <Label mono size={10} secondary>
                  {projectName(id)}
                </Label>
                <Label size={11} secondary>
                  {copy(
                    id === 'atlas'
                      ? 'atlasStatus'
                      : id === 'juno'
                        ? 'junoNeeds'
                        : 'vegaStatus',
                  )}
                </Label>
              </View>
              <Label mono secondary size={9}>
                {id === 'atlas' ? '11:06' : id === 'juno' ? '10:58' : '08:06'}
              </Label>
            </Button>
          </If>
        ))}
        <If
          when={
            !!query() &&
            !['atlas tian-agent', 'juno healthapp', 'vega d2r-mobile'].some(
              (row) => row.includes(query().toLowerCase()),
            )
          }
        >
          <Label secondary>{copy('noResults')}</Label>
        </If>
        <Label mono secondary size={9}>
          {copy('preview')}
        </Label>
      </Scroll>
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 12,
          right: 12,
          paddingBottom: Math.max(safeArea().bottom, 12),
        }}
      >
        <Floating>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Round
              label={copy('shareShortcut')}
              icon="camera"
              onPress={() => shareOpen.set(true)}
            />
            <Button
              accessibilityLabel={copy('askChief')}
              onPress={() => openConversation('chief')}
              style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
            >
              <Label secondary>{copy('askChief')}</Label>
            </Button>
            <Round
              label={copy('openChief')}
              icon="arrowRight"
              onPress={() => openConversation('chief')}
            />
          </View>
        </Floating>
      </View>
      <ShareSheet open={shareOpen()} close={() => shareOpen.set(false)} />
    </View>
  );
}
function projectName(id: ConvId) {
  return id === 'atlas'
    ? 'tian-agent'
    : id === 'juno'
      ? 'healthapp'
      : 'd2r-mobile';
}
function ShareSheet(props: { open: boolean; close: () => void }) {
  const target = signal<ConvId>('chief');
  const note = signal('');
  const images = signal<{ uri: string; name: string }[]>([]);
  const picking = signal(false);
  const choose = async () => {
    if (picking()) return;
    picking.set(true);
    try {
      const files = await Picker.pickImages({
        limit: 4,
        maxDimension: imageDownscale() ? 2560 : undefined,
      });
      images.update((rows) => [
        ...rows,
        ...files.map((file) => {
          const uri = URL.createObjectURL(file.file);
          urls.add(uri);
          return { uri, name: file.file.name };
        }),
      ]);
    } catch {
      notice.set(copy('pickerError'));
    } finally {
      picking.set(false);
    }
  };
  const close = () => {
    for (const image of images()) {
      URL.revokeObjectURL(image.uri);
      urls.delete(image.uri);
    }
    images.set([]);
    note.set('');
    props.close();
  };
  return (
    <Dialog
      open={props.open}
      presentation="pageSheet"
      onOpenChange={(e) => {
        if (!e.open) close();
      }}
      style={{
        flex: 1,
        padding: 24,
        gap: 18,
        backgroundColor: palette(look()).winSolid,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Label serif size={28}>
          {copy('share')}
        </Label>
        <View style={{ flex: 1 }} />
        <Round label={copy('cancel')} icon="x" onPress={close} />
      </View>
      <Label secondary>{copy('shareEmpty')}</Label>
      <Action
        label={copy('chooseImage')}
        icon="attach"
        disabled={picking()}
        onPress={() => {
          void choose();
        }}
      />
      <Scroll
        horizontal
        style={{ maxHeight: 150 }}
        contentStyle={{ flexDirection: 'row', gap: 8 }}
      >
        <Each of={images()}>
          {(image) => (
            <Image
              src={image().uri}
              accessibilityLabel={image().name}
              style={{
                width: 120,
                height: 140,
                borderRadius: 14,
                objectFit: 'cover',
              }}
            />
          )}
        </Each>
      </Scroll>
      <Section>{copy('target')}</Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {(['chief', 'atlas', 'juno', 'vega'] as const).map((id) => (
          <Button
            accessibilityLabel={id}
            selected={target() === id}
            onPress={() => target.set(id)}
            style={{
              alignItems: 'center',
              padding: 8,
              borderWidth: 1,
              borderRadius: 14,
              borderColor:
                target() === id ? palette(look()).text : palette(look()).line,
            }}
          >
            <Avatar id={id} size={42} />
            <Label size={12}>
              {id === 'chief'
                ? 'Chief'
                : id === 'atlas'
                  ? 'Atlas'
                  : id === 'juno'
                    ? 'Juno'
                    : 'Vega'}
            </Label>
          </Button>
        ))}
      </View>
      <Input
        accessibilityLabel={copy('shareNote')}
        value={note()}
        onChange={(e) => note.set(e.value)}
        placeholder={copy('shareNote')}
        multiline
        style={{
          minHeight: 80,
          padding: 12,
          borderRadius: 14,
          backgroundColor: palette(look()).card,
          color: palette(look()).text,
          placeholderColor: palette(look()).text3,
        }}
      />
      <Action
        primary
        label={copy('attach')}
        disabled={images().length === 0}
        onPress={() => {
          const id = target();
          attachments.update((rows) => ({
            ...rows,
            [id]: [...rows[id], ...images()],
          }));
          if (note()) {
            /* The note stays a draft until Send is pressed. */ setDraft(
              id,
              note(),
            );
          }
          images.set([]);
          note.set('');
          props.close();
          openConversation(id);
          notice.set(copy('shareDone'));
        }}
      />
    </Dialog>
  );
}
function setDraft(id: ConvId, value: string) {
  drafts.update((rows) => ({ ...rows, [id]: value }));
}
