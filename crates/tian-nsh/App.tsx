import { effect, mount, View, colorScheme, setColorScheme } from 'nsh';
import { Menu, Window } from 'nsh/desktop';
import { palette } from './theme';
import {
  ambientLight,
  followSystem,
  goTo,
  inspector,
  inspectorTab,
  look,
  openSettings,
  paletteOpen,
  settingsOpen,
  toggleLook,
} from './state';
import { Sidebar } from './Sidebar';
import { Chat } from './Chat';
import { Inspector } from './Inspector';
import { Settings } from './Settings';
import { Palette } from './Palette';

function Shell() {
  const t = palette(look());
  return (
    <View
      style={{
        flex: 1,
        position: 'relative',
        backgroundColor: t.page,
        backgroundImage: t.wall,
      }}
    >
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          backgroundColor: t.win,
          backgroundImage: t.inside,
          backdropFilter: 'blur(50px) saturate(1.5)',
          boxShadow: t.rimStrong,
        }}
      >
        <Sidebar />
        <Chat />
        <If when={inspector()}>
          <Inspector />
        </If>
      </View>

      <If when={ambientLight()}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 420,
            backgroundImage: `radial-gradient(circle at 12% 12%, ${t.sun}, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
      </If>

      <If when={settingsOpen()}>
        <Settings />
      </If>
      <If when={paletteOpen()}>
        <Palette />
      </If>
    </View>
  );
}

function App() {
  Window.setTitle('Tian');
  Window.setFrame({ size: { width: 1336, height: 812 } });
  Window.setTitleBar({ style: 'hidden', height: 52 });

  effect(() => {
    if (followSystem()) {
      setColorScheme('system');
      look.set(colorScheme() === 'dark' ? 'night' : 'day');
    } else {
      setColorScheme(look() === 'day' ? 'light' : 'dark');
    }
  });

  effect(() => {
    const closeOverlay = () => {
      if (paletteOpen()) paletteOpen.set(false);
      else if (settingsOpen()) settingsOpen.set(false);
    };
    Menu.setApplicationMenu([
      {
        label: 'Tian',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: '设置…', shortcut: 'mod+,', onSelect: () => openSettings() },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'showAll' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: '文件',
        submenu: [
          { label: '新对话', shortcut: 'mod+n', onSelect: () => goTo('chief') },
          {
            label: '搜索或跳转…',
            shortcut: 'mod+k',
            onSelect: () => paletteOpen.set(true),
          },
          { type: 'separator' },
          { label: '关闭浮层', shortcut: 'escape', onSelect: closeOverlay },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: '显示',
        submenu: [
          {
            label: '切换检查器',
            shortcut: 'mod+b',
            checked: inspector(),
            onSelect: () => inspector.set(!inspector()),
          },
          {
            label: '外观',
            submenu: [
              {
                label: '夜',
                checked: look() === 'night' && !followSystem(),
                onSelect: () => {
                  followSystem.set(false);
                  look.set('night');
                },
              },
              {
                label: '昼',
                checked: look() === 'day' && !followSystem(),
                onSelect: () => {
                  followSystem.set(false);
                  look.set('day');
                },
              },
              { type: 'separator' },
              {
                label: '切换昼夜',
                shortcut: 'mod+shift+l',
                onSelect: toggleLook,
              },
            ],
          },
          {
            label: '改动',
            checked: inspectorTab() === 'changes',
            onSelect: () => {
              inspector.set(true);
              inspectorTab.set('changes');
            },
          },
          {
            label: '任务',
            checked: inspectorTab() === 'tasks',
            onSelect: () => {
              inspector.set(true);
              inspectorTab.set('tasks');
            },
          },
          {
            label: '详情',
            checked: inspectorTab() === 'details',
            onSelect: () => {
              inspector.set(true);
              inspectorTab.set('details');
            },
          },
          { type: 'separator' },
          { role: 'toggleFullScreen' },
        ],
      },
      {
        label: '对话',
        submenu: [
          { label: 'Chief', shortcut: 'mod+0', onSelect: () => goTo('chief') },
          { label: 'Atlas', shortcut: 'mod+1', onSelect: () => goTo('atlas') },
          { label: 'Juno', shortcut: 'mod+2', onSelect: () => goTo('juno') },
          { label: 'Vega', shortcut: 'mod+3', onSelect: () => goTo('vega') },
        ],
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          { label: '设计说明', onSelect: () => openSettings('appearance') },
          { label: '关于 Tian', onSelect: () => openSettings('server') },
        ],
      },
    ]);
  });

  return (
    <View style={{ flex: 1, position: 'relative' }}>
      <If when={look() === 'night'}>
        <Shell />
      </If>
      <If when={look() === 'day'}>
        <Shell />
      </If>
    </View>
  );
}

mount(App);
