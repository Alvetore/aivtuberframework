import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Application } from 'pixi.js';
import type { Live2DModel as Live2DModelInstance } from 'pixi-live2d-display/cubism4';
import { avatarLayout } from './layout';
import { useCopy } from '../i18n/useCopy';

interface Props {
  modelPath?: string;
  scale?: number;
  mouthOpen: number;
  offsetX?: number;
  offsetY?: number;
  onState?: (state: 'loading' | 'loaded' | 'error', error?: string) => void;
  clean?: boolean;
}

function getModelAssetUrl(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/');
  const filename = normalized.substring(normalized.lastIndexOf('/') + 1);
  return `/api/avatar/model/${encodeURIComponent(filename)}`;
}

export function Live2DCanvas({ modelPath, scale = 1.0, mouthOpen, offsetX = 0, offsetY = 0, onState, clean = false }: Props) {
  const c=useCopy();
  const copyRef=useRef(c); copyRef.current=c;
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const naturalSize = useRef({ width: 1, height: 1 });
  const layoutRef = useRef({ scale, offsetX, offsetY });
  layoutRef.current = { scale, offsetX, offsetY };
  const onStateRef = useRef(onState); onStateRef.current = onState;
  const mouthRef = useRef(mouthOpen); mouthRef.current = mouthOpen;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Update layout (centering & scaling)
  const updateLayout = useCallback(() => {
    const model = modelRef.current;
    const app = appRef.current;
    const container = containerRef.current;
    if (!model || !app || !container) return;

    const viewW = container.clientWidth || app.screen.width || 400;
    const viewH = container.clientHeight || app.screen.height || 600;

    if (naturalSize.current.width > 0 && naturalSize.current.height > 0) {
      const options = layoutRef.current;
      const layout = avatarLayout(viewW, viewH, naturalSize.current.width, naturalSize.current.height, options.scale, options.offsetX, options.offsetY);
      model.scale.set(layout.scale);
      model.anchor.set(0.5, 0.5);
      model.x = layout.x;
      model.y = layout.y;
    }
  }, []);

  // Update layout when scale prop changes
  useEffect(() => {
    updateLayout();
  }, [scale, offsetX, offsetY, updateLayout]);

  // Update mouthOpen parameter on live model
  useEffect(() => {
    const model = modelRef.current;
    if (!model?.internalModel?.coreModel) return;
    try {
      const core = model.internalModel.coreModel as any;
      const paramIndex = core.getParameterIndex?.('ParamMouthOpenY') ?? -1;
      if (paramIndex >= 0) {
        core.setParameterValueByIndex?.(paramIndex, Math.max(0, Math.min(1, mouthOpen)));
      } else if (core.setParameterValueById) {
        core.setParameterValueById('ParamMouthOpenY', Math.max(0, Math.min(1, mouthOpen)));
      }
    } catch {
      // ignore lipsync update errors
    }
  }, [mouthOpen]);

  // Load and mount Live2D model
  useEffect(() => {
    if (!containerRef.current || !modelPath) return;

    if (typeof window !== 'undefined' && !(window as any).Live2DCubismCore) {
      const message = copyRef.current('Live2DCubismCore не инициализирован. Убедитесь, что SDK Cubism Core загружен.','Live2DCubismCore is not initialized. Make sure the Cubism Core SDK has loaded.');
      setError(message); onStateRef.current?.('error', message);
      return;
    }

    let destroyed = false;
    setLoading(true);
    setError(null);
    onStateRef.current?.('loading');

    // Window / container resize observer
    const handleResize = () => updateLayout();
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => updateLayout());
      resizeObserver.observe(containerRef.current);
    }

    // PIXI and the Live2D runtime are loaded only when a model is actually used.
    void (async () => {
      try {
        const [pixi, live2d] = await Promise.all([
          import('pixi.js'),
          import('pixi-live2d-display/cubism4'),
        ]);
        if (destroyed || !containerRef.current) return;

        (window as unknown as { PIXI: typeof pixi }).PIXI = pixi;
        try { live2d.Live2DModel.registerTicker(pixi.Ticker as never); } catch { /* already registered */ }

        const app = new pixi.Application({
          backgroundAlpha: 0,
          resizeTo: containerRef.current,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        });
        appRef.current = app;
        containerRef.current.appendChild(app.view as HTMLCanvasElement);

        const model = await live2d.Live2DModel.from(getModelAssetUrl(modelPath), { autoInteract: false });
        if (destroyed) {
          model.destroy();
          return;
        }
        modelRef.current = model;
        naturalSize.current = { width: model.width, height: model.height };
        app.stage.addChild(model);
        // Motion evaluation can overwrite mouth values; write after its update.
        model.internalModel?.on?.('beforeModelUpdate', () => {
          (model.internalModel.coreModel as any)?.setParameterValueById?.('ParamMouthOpenY', Math.max(0, Math.min(1, mouthRef.current)));
        });

        updateLayout();
        setLoading(false);
        onStateRef.current?.('loaded');
      } catch (err) {
        if (!destroyed) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error('[Live2D] Ошибка загрузки модели:', error);
          setError(copyRef.current('Не удалось загрузить Live2D модель: ','Could not load the Live2D model: ')+(error.message || String(error)));
          setLoading(false);
          onStateRef.current?.('error', error.message || String(error));
        }
      }
    })();

    return () => {
      destroyed = true;
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) resizeObserver.disconnect();

      if (modelRef.current) {
        try { modelRef.current.destroy(); } catch { /* ignore */ }
        modelRef.current = null;
      }
      if (appRef.current) {
        try { appRef.current.destroy(true, { children: true }); } catch { /* ignore */ }
        appRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [modelPath, reloadKey, updateLayout]);

  if (!modelPath) {
    return null;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {loading && !clean && (
        <div style={{ position: 'absolute', color: '#d7b6ff', fontSize: '14px', fontWeight: 'bold', zIndex: 10, background: 'rgba(18,16,28,0.7)', padding: '8px 16px', borderRadius: '8px', backdropFilter: 'blur(4px)' }}>
          {c('Загрузка Live2D модели…','Loading Live2D model…')}
        </div>
      )}
      {error && !clean && (
        <div style={{ position: 'absolute', color: '#ffaca5', fontSize: '12px', textAlign: 'center', maxWidth: '360px', padding: '12px', background: 'rgba(28,24,44,0.92)', borderRadius: '8px', border: '1px solid #7e2d2d', zIndex: 20 }}>
          <strong style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>{c('Ошибка загрузки Live2D','Live2D loading error')}</strong>
          <p style={{ margin: '4px 0 8px 0', wordBreak: 'break-word', color: '#ffd0cc' }}>{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              background: '#7e57c2',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '5px 12px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            {c('Повторить попытку','Try again')}
          </button>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
    </div>
  );
}
