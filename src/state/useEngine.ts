import { useSyncExternalStore } from 'react';
import { engine } from '../audio/engine';

/** 订阅引擎状态（轨道/听者/工程/音频解锁状态/解码状态） */
export function useEngine() {
  useSyncExternalStore(
    engine.subscribe,
    () => engine.version,
    () => 0,
  );
  return engine;
}
