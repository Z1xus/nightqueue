export {};

declare global {
  namespace Spicetify {
    namespace ContextMenu {
      type OnClick = (uris: string[], uids?: string[], contextUri?: string) => void;
      type ShouldAdd = (uris: string[], uids?: string[], contextUri?: string) => boolean;

      class Item {
        constructor(name: string, onClick: OnClick, shouldAdd?: ShouldAdd, icon?: string);
        register(): void;
        deregister(): void;
      }

      class SubMenu {
        constructor(name: string, items: Item[], shouldAdd?: ShouldAdd, icon?: string);
        register(): void;
        deregister(): void;
      }
    }

    const LocalStorage: {
      get(key: string): string | null;
      set(key: string, value: string): void;
      remove(key: string): void;
    };

    const Platform: {
      PlaybackAPI: unknown;
      History: { push(path: string): void };
    } & Record<string, unknown>;

    function showNotification(text: string, isError?: boolean, msTimeout?: number): void;
  }
}
