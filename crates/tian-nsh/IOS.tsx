import {
  announce,
  cleanup,
  colorScheme,
  effect,
  mount,
  setColorScheme,
  View,
  safeArea,
} from 'nsh';
import { NavPage, NavStack } from 'nsh/base';
import { MobileHome } from './MobileHome';
import { MobileChat } from './MobileChat';
import { MobileDiff } from './MobileDiff';
import { MobileSetting, MobileSettings } from './MobileSettings';
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
import {
  navigation,
  notice,
  persistPreferences,
  type Route,
} from './mobile-state';
import { palette } from './theme';
import { Label } from './MobileUI';

function Page(props: { route: Route }) {
  const route = props.route;
  return (
    <NavPage
      headerVisible={false}
      statusBar={{ foreground: look() === 'night' ? 'light' : 'dark' }}
      style={{ flex: 1, backgroundColor: palette(look()).winSolid }}
    >
      <If when={route.page === 'home'}>
        <MobileHome />
      </If>
      <If when={route.page === 'chat'}>
        <MobileChat id={(route as Extract<Route, { page: 'chat' }>).id} />
      </If>
      <If when={route.page === 'diff'}>
        <MobileDiff />
      </If>
      <If when={route.page === 'settings'}>
        <MobileSettings />
      </If>
      <If when={route.page === 'setting'}>
        <MobileSetting id={(route as Extract<Route, { page: 'setting' }>).id} />
      </If>
    </NavPage>
  );
}
function Shell() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette(look()).page,
        backgroundImage: palette(look()).inside,
      }}
    >
      <NavStack state={navigation} style={{ flex: 1 }}>
        {(route) => <Page route={route} />}
      </NavStack>
      <If when={!!notice()}>
        <View
          android={{ accessibilityLiveRegion: 'polite' }}
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: safeArea().top,
            left: 20,
            right: 20,
            padding: 12,
            borderRadius: 14,
            backgroundColor: palette(look()).float,
            borderWidth: 1,
            borderColor: palette(look()).line2,
          }}
        >
          <Label size={11}>{notice()}</Label>
        </View>
      </If>
    </View>
  );
}
function IOS() {
  chatSize.set(14);
  persistPreferences({
    theme: () => (followSystem() ? 'system' : look()),
    setTheme: (value) => {
      followSystem.set(value === 'system');
      if (value !== 'system') look.set(value);
    },
    glass,
    ambient: ambientLight,
    motion: reduceMotion,
    size: chatSize,
    wrap: codeWrap,
    capture: captureSuggest,
  });
  effect(() => {
    if (followSystem()) {
      setColorScheme('system');
      look.set(colorScheme() === 'dark' ? 'night' : 'day');
    } else setColorScheme(look() === 'night' ? 'dark' : 'light');
  });
  effect(() => {
    if (!notice()) return;
    const timer = setTimeout(() => notice.set(''), 3500);
    announce(notice());
    cleanup(() => clearTimeout(timer));
  });
  return (
    <>
      <If when={look() === 'night'}>
        <Shell />
      </If>
      <If when={look() === 'day'}>
        <Shell />
      </If>
    </>
  );
}
mount(IOS);
