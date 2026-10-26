import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Language = 'ru' | 'en';

export const DICTIONARY = {
  ru: {
    // Sidebar
    'nav.dashboard': 'Дашборд',
    'nav.character': 'Персонаж',
    'nav.llm': 'LLM',
    'nav.behavior': 'Поведение',
    'nav.tts': 'TTS',
    'nav.twitch': 'Twitch',
    'nav.avatar': 'Аватар',
    'nav.logs': 'Логи',
    'nav.panel': 'Панель управления',

    // Status Cards
    'status.twitch': 'Twitch',
    'status.llm': 'LLM',
    'status.tts': 'TTS',
    'status.avatar': 'Аватар',
    'status.connected': 'Подключен',
    'status.disconnected': 'Отключен',
    'status.ready': 'Готов',
    'status.unconfigured': 'Не настроен',
    'status.speaking': 'Говорит',
    'status.idle': 'Ожидание',
    'status.disabled': 'Отключен',

    // Common buttons
    'btn.save': 'Сохранить',
    'btn.saving': 'Сохранение…',
    'btn.saved': 'Настройки сохранены',
    'btn.close': 'Закрыть',
    'btn.start': 'Запустить',
    'btn.stop': 'Остановить',
    'btn.openAvatar': '🪟 Открыть окно аватара (для OBS)',
    'btn.closeAvatar': '✕ Закрыть окно аватара',
    'btn.selectModel': '📁 Выбрать файл или ZIP-архив...',
    'btn.loadModels': '🔄 Загрузить список моделей',
    'btn.loadingModels': 'Загрузка...',
    'btn.twitchLogin': '🟣 Войти через Twitch (в 1 клик)',
    'btn.twitchWaiting': 'Ожидание авторизации...',
    'btn.connectTwitch': 'Подключить Twitch',
    'btn.disconnectTwitch': 'Отключить',

    // Character Form
    'char.title': 'Имя персонажа',
    'char.titleTooltip': 'Имя виртуального ведущего. На это имя ведущая будет реагировать в чате Twitch при прямых обращениях (например: @VTuber).',
    'char.language': 'Язык общения',
    'char.languageTooltip': 'Основной язык реплик ведущей. При выборе «Авто» бот отвечает на языке обратившегося зрителя.',
    'char.langRu': '🇷🇺 Русский (Russian)',
    'char.langEn': '🇬🇧 Английский (English)',
    'char.langAuto': '🌐 Автоопределение (Auto / Язык чата)',
    'char.prompt': 'Описание персонажа',
    'char.promptTooltip': 'Личность, характер, предыстория и привычки ведущей. Задает то, кем является персонаж и как относится к зрителям.',
    'char.style': 'Стиль общения',
    'char.styleTooltip': 'Инструкции по формату реплик. Рекомендуется: «Отвечай кратко, 1-2 живыми предложениями, с юмором, без формализма».',

    // LLM Form
    'llm.endpoint': 'API endpoint',
    'llm.endpointTooltip': 'Базовый URL OpenAI-совместимого API. Например: https://api.openai.com/v1, https://openrouter.ai/api/v1, или http://localhost:11434/v1 (локальная Ollama).',
    'llm.apiKey': 'API key',
    'llm.apiKeyTooltip': 'Секретный API-ключ. Надежно шифруется на диске через Electron safeStorage. Для локальных серверов (Ollama) можно ввести любое слово (напр. ollama).',
    'llm.model': 'Модель',
    'llm.modelTooltip': 'Имя нейросетевой модели (напр. gpt-4o-mini, deepseek/deepseek-chat). Нажмите кнопку справа, чтобы подгрузить список моделей с вашего endpoint.',
    'llm.modelPlaceholder': 'Выберите из списка или введите имя (напр. gpt-4o-mini)',
    'llm.modelsAvailable': 'Доступно моделей: {n}. Выберите из выпадающего списка или введите вручную.',
    'llm.temperature': 'Температура',
    'llm.temperatureTooltip': 'Креативность генерации (от 0 до 2). 0.2–0.5 — строгие и буквальные ответы, 0.7–0.9 — живые и естественные (рекомендуется для стрима), >1.2 — хаотичные.',
    'llm.maxTokens': 'Макс. токенов',
    'llm.maxTokensTooltip': 'Максимальная длина реплики (1 токен ≈ 3-4 буквы). Значение 150–250 идеально подходит для коротких и динамичных стримерских ответов.',

    // Behavior Form
    'behavior.mode': 'Режим работы',
    'behavior.modeTooltip': 'В режиме Reactive бот говорит только при вопросах или обращении к нему. В режиме Streamer ведущая берет инициативу и говорит сама при затишье в чате.',
    'behavior.reactive': 'Reactive (только на вопросы и обращения)',
    'behavior.streamer': 'Streamer (активный стрим и монологи)',
    'behavior.contextLimit': 'Сообщений в контексте',
    'behavior.contextLimitTooltip': 'Количество последних сообщений чата, отправляемых в LLM. Значение 15–30 позволяет поддерживать естественный диалог и помнить предыдущие реплики.',
    'behavior.idleTimeout': 'Таймаут тишины (сек.)',
    'behavior.idleTimeoutTooltip': 'Время молчания чата (в секундах), после которого ведущая в режиме Streamer начнет говорить сама, чтобы на стриме не было неловкой паузы.',
    'behavior.cooldown': 'Пауза между ответами (сек.)',
    'behavior.cooldownTooltip': 'Обязательная пауза между репликами ведущей. Позволяет зрителям спокойно прослушать ответ и написать реакцию.',
    'behavior.maxPerMin': 'Макс. ответов в минуту',
    'behavior.maxPerMinTooltip': 'Ограничитель частоты реплик в минуту. Защищает от спама при высоком онлайне в чате и контролирует баланс токенов.',

    // TTS Form
    'tts.enabled': 'Озвучивание включено (TTS Enabled)',
    'tts.enabledTooltip': 'Включение голосовой озвучки. Если отключено, бот будет генерировать ответы только текстом в лог и чат.',
    'tts.engine': 'Движок TTS',
    'tts.engineTooltip': 'Движок генерации речи. Web Speech работает прямо из Windows. Silero — локальная нейросеть с GPU. OpenAI и ElevenLabs — реалистичные облачные сервисы.',
    'tts.engineWebspeech': 'Web Speech (системный синтезатор Windows, бесплатно)',
    'tts.engineSilero': 'Silero (локальная нейросеть с GPU-ускорением)',
    'tts.engineOpenai': 'OpenAI TTS (облачный, студийное качество, рус/англ)',
    'tts.engineElevenlabs': 'ElevenLabs (облачный, эмоциональные голоса)',
    'tts.voice': 'Голос Web Speech (системный)',
    'tts.voiceTooltip': 'Синтезатор речи, установленный в вашей системе. Для стримов на русском выбирайте голоса со значком 🇷🇺 (например, Microsoft Irina или Dariya).',
    'tts.sileroServer': 'Локальный сервер Silero TTS',
    'tts.sileroRunning': '● Сервер работает',
    'tts.sileroStopped': '● Сервер остановлен',
    'tts.sileroAutoInstall': 'При нажатии сервер автоматически проверит и установит нужные библиотеки Python и запустит нейросеть.',
    'tts.sileroSpeaker': 'Голос диктора Silero',
    'tts.sileroSpeakerTooltip': 'Персонаж озвучки Silero. Ксения и Байя — естественные женские голоса, Евгений и Айдар — мужские.',
    'tts.sileroEndpoint': 'Silero endpoint URL',
    'tts.sileroEndpointTooltip': 'Локальный адрес сервера синтеза. По умолчанию http://127.0.0.1:5000.',
    'tts.sileroSampleRate': 'Частота дискретизации (Sample rate)',
    'tts.sileroSampleRateTooltip': 'Качество звука аудиопотока. 48000 Гц обеспечивает чистый, звонкий звук голоса на стриме без артефактов сжатия.',
    'tts.openaiEndpoint': 'OpenAI TTS API Endpoint',
    'tts.openaiEndpointTooltip': 'URL для синтеза речи. По умолчанию https://api.openai.com/v1/audio/speech или любой совместимый сервис.',
    'tts.openaiApiKey': 'OpenAI TTS API Key',
    'tts.openaiApiKeyTooltip': 'API-ключ для OpenAI TTS. Если оставить пустым, будет использоваться ключ из раздела LLM.',
    'tts.openaiModel': 'Модель OpenAI TTS',
    'tts.openaiModelTooltip': 'tts-1 — быстрая с низкой задержкой (рекомендуется для стрима); tts-1-hd — максимальная детализация звука.',
    'tts.openaiVoice': 'Голос OpenAI TTS',
    'tts.openaiVoiceTooltip': 'Выбор характера голоса: nova, shimmer (женские); alloy, echo, fable, onyx (разнообразные мужские и нейтральные).',
    'tts.elevenlabsApiKey': 'ElevenLabs API Key (xi-api-key)',
    'tts.elevenlabsApiKeyTooltip': 'Секретный ключ API ElevenLabs. Найдите его в личном кабинете на elevenlabs.io.',
    'tts.elevenlabsVoiceId': 'Voice ID диктора',
    'tts.elevenlabsVoiceIdTooltip': 'Идентификатор голоса. По умолчанию 21m00Tcm4TlvDq8ikWAM (Rachel). Можно указать ID любого созданного или клонированного голоса.',
    'tts.elevenlabsModel': 'Модель ElevenLabs',
    'tts.elevenlabsModelTooltip': 'eleven_multilingual_v2 обеспечивает естественное и эмоциональное произношение на русском и английском языках.',

    // Twitch Form
    'twitch.autoConnect': 'Подключение в 1 клик через браузер',
    'twitch.autoHint': 'Нажмите кнопку ниже, чтобы войти в свою учетную запись Twitch. Токен авторизации будет получен автоматически и зашифрован в безопасном хранилище.',
    'twitch.manualHint': 'Или вы можете настроить параметры вручную. OAuth token шифруется в безопасном хранилище Electron (safeStorage).',
    'twitch.username': 'Логин Twitch бота',
    'twitch.usernameTooltip': 'Имя учетной записи Twitch, под которой подключается бот. При использовании кнопки «Войти через Twitch» выше заполняется автоматически.',
    'twitch.channel': 'Канал стрима (куда подключаться)',
    'twitch.channelTooltip': 'Имя канала Twitch (без решетки #), в чат которого бот войдет для чтения сообщений зрителей стрима.',
    'twitch.token': 'OAuth token (ручной ввод)',
    'twitch.tokenTooltip': 'Секретный токен для доступа к чату Twitch формата oauth:xxxxx. Шифруется локально на вашем ПК.',

    // Avatar Form
    'avatar.mode': 'Режим аватара',
    'avatar.modeTooltip': 'Выберите способ отображения аватара: встроенный рендерер с отдельным окном для OBS либо управление внешней программой VTube Studio по WebSocket.',
    'avatar.disabled': 'Выключен (только голос и чат)',
    'avatar.internal': 'Internal Live2D (Встроенный рендерер и окно для OBS)',
    'avatar.vts': 'VTube Studio (Управление внешней программой)',
    'avatar.windowTitle': 'Окно аватара для OBS Studio',
    'avatar.windowDesc': 'Отдельное окно для захвата в OBS. Поддерживает прозрачный фон или хромакей. Рот открывается в такт речи (Lip-Sync).',
    'avatar.method1Title': 'Способ 1: Прямая прозрачность (Рекомендуется)',
    'avatar.method1Step1': 'Нажмите кнопку «Открыть окно аватара».',
    'avatar.method1Step2': 'В OBS добавьте источник «Захват окна».',
    'avatar.method1Step3': 'Выберите «AI VTuber Avatar Overlay».',
    'avatar.method1Step4': 'Поставьте галочку «Разрешить прозрачность» (Allow Transparency).',
    'avatar.method2Title': 'Способ 2: Зеленый хромакей (Chroma Key)',
    'avatar.method2Step1': 'В шапке окна аватара включите 🟢 Хромакей.',
    'avatar.method2Step2': 'В OBS нажмите ПКМ по источнику захвата → «Фильтры» (Filters).',
    'avatar.method2Step3': 'В блоке «Фильтры эффектов» нажмите «+» → «Хромакей».',
    'avatar.method2Step4': 'Тип цвета: Зеленый (фон мгновенно станет невидимым).',
    'avatar.bgLabel': 'Фон окна аватара по умолчанию',
    'avatar.bgTooltip': 'Цвет фона окна аватара. Можно также переключать в 1 клик прямо в верхней плашке самого окна аватара.',
    'avatar.bgTransparent': 'Прозрачный (Direct Alpha для OBS)',
    'avatar.bgGreen': '🟢 Зеленый хромакей (#00FF00)',
    'avatar.bgBlue': '🔵 Синий хромакей (#0000FF)',
    'avatar.bgMagenta': '🟣 Пурпурный хромакей (#FF00FF)',
    'avatar.modelLabel': 'Файл модели Live2D (.model3.json или .zip)',
    'avatar.modelTooltip': 'Нажмите «Выбрать файл или ZIP-архив...», чтобы выбрать модель с компьютера. Если вы скачали ZIP-архив (с Booth/Nizima), приложение автоматически распакует все файлы (текстуры, физику, движения) и найдет файл .model3.json!',
    'avatar.scale': 'Масштаб отображения модели (Scale)',
    'avatar.scaleTooltip': 'Масштаб модели внутри оверлейного окна. Подберите комфортный размер для вашего разрешения стрима.',
    'avatar.vtsUrl': 'VTube Studio WebSocket URL',
    'avatar.vtsUrlTooltip': 'Адрес встроенного WebSocket API программы VTube Studio. По умолчанию ws://127.0.0.1:8001.',
    'avatar.vtsGuideTitle': 'Как настроить VTube Studio:',
    'avatar.vtsGuide1': 'Запустите программу VTube Studio на этом ПК.',
    'avatar.vtsGuide2': 'Откройте Настройки (шестерёнка) → вкладка с иконкой штекера (Plugin API).',
    'avatar.vtsGuide3': 'Включите переключатель «Start API (allow plugins)». Убедитесь, что указан порт 8001.',
    'avatar.vtsGuide4': 'При первом обращении VTube Studio покажет окно «Allow plugin?», нажмите Allow.',
    'avatar.vtsGuide5': 'Фреймворк начнет синхронизировать параметр рта MouthOpen при озвучке реплик.',

    // Tester & Logs
    'test.title': 'Тестирование реплик',
    'test.placeholder': 'Введите тестовую фразу...',
    'test.btn': 'Отправить',
    'logs.title': 'Системный журнал событий',
    'logs.empty': 'Журнал пуст.',
  },

  en: {
    // Sidebar
    'nav.dashboard': 'Dashboard',
    'nav.character': 'Character',
    'nav.llm': 'LLM',
    'nav.behavior': 'Behavior',
    'nav.tts': 'TTS',
    'nav.twitch': 'Twitch',
    'nav.avatar': 'Avatar',
    'nav.logs': 'Logs',
    'nav.panel': 'Control Panel',

    // Status Cards
    'status.twitch': 'Twitch',
    'status.llm': 'LLM',
    'status.tts': 'TTS',
    'status.avatar': 'Avatar',
    'status.connected': 'Connected',
    'status.disconnected': 'Disconnected',
    'status.ready': 'Ready',
    'status.unconfigured': 'Not Configured',
    'status.speaking': 'Speaking',
    'status.idle': 'Idle',
    'status.disabled': 'Disabled',

    // Common buttons
    'btn.save': 'Save',
    'btn.saving': 'Saving…',
    'btn.saved': 'Settings saved',
    'btn.close': 'Close',
    'btn.start': 'Start',
    'btn.stop': 'Stop',
    'btn.openAvatar': '🪟 Open Avatar Window (for OBS)',
    'btn.closeAvatar': '✕ Close Avatar Window',
    'btn.selectModel': '📁 Select File or ZIP Archive...',
    'btn.loadModels': '🔄 Fetch Models List',
    'btn.loadingModels': 'Loading...',
    'btn.twitchLogin': '🟣 Login via Twitch (1-Click)',
    'btn.twitchWaiting': 'Waiting for authorization...',
    'btn.connectTwitch': 'Connect Twitch',
    'btn.disconnectTwitch': 'Disconnect',

    // Character Form
    'char.title': 'Character Name',
    'char.titleTooltip': 'The virtual streamer’s name. The bot responds to direct @mentions in Twitch chat.',
    'char.language': 'Dialogue Language',
    'char.languageTooltip': 'Primary language of VTuber replies. When set to "Auto", replies in the language used by the viewer.',
    'char.langRu': '🇷🇺 Russian',
    'char.langEn': '🇬🇧 English',
    'char.langAuto': '🌐 Auto-detect (Viewer language)',
    'char.prompt': 'Character Description',
    'char.promptTooltip': 'Personality, lore, background, and habits. Defines who the VTuber is and how they relate to chat viewers.',
    'char.style': 'Response Style',
    'char.styleTooltip': 'Guidelines for dialogue style. Recommended: "Reply dynamically and briefly in 1-2 sentences with humor, avoiding formal jargon."',

    // LLM Form
    'llm.endpoint': 'API Endpoint',
    'llm.endpointTooltip': 'Base URL of any OpenAI-compatible API. Examples: https://api.openai.com/v1, https://openrouter.ai/api/v1, or http://localhost:11434/v1 (local Ollama).',
    'llm.apiKey': 'API Key',
    'llm.apiKeyTooltip': 'Secret API key. Encrypted locally on disk using Electron safeStorage. For local Ollama, you can enter any word.',
    'llm.model': 'Model',
    'llm.modelTooltip': 'Neural network model ID (e.g. gpt-4o-mini, deepseek/deepseek-chat). Click "Fetch Models List" to retrieve models from your endpoint.',
    'llm.modelPlaceholder': 'Select from list or type name (e.g. gpt-4o-mini)',
    'llm.modelsAvailable': 'Models available: {n}. Select from dropdown or enter manually.',
    'llm.temperature': 'Temperature',
    'llm.temperatureTooltip': 'Generation creativity (0 to 2). 0.2–0.5 is strict and literal, 0.7–0.9 is natural and witty (recommended for stream), >1.2 is chaotic.',
    'llm.maxTokens': 'Max Tokens',
    'llm.maxTokensTooltip': 'Maximum reply length (1 token ≈ 3-4 chars). 150–250 is optimal for quick, lively stream responses.',

    // Behavior Form
    'behavior.mode': 'Operating Mode',
    'behavior.modeTooltip': 'In Reactive mode, the bot only responds when asked or mentioned. In Streamer mode, the bot initiates conversation during silence.',
    'behavior.reactive': 'Reactive (only on questions and mentions)',
    'behavior.streamer': 'Streamer (active stream commentary and monologues)',
    'behavior.contextLimit': 'Context Messages Limit',
    'behavior.contextLimitTooltip': 'Number of recent chat messages sent to the LLM. 15–30 helps maintain conversational context.',
    'behavior.idleTimeout': 'Silence Timeout (sec)',
    'behavior.idleTimeoutTooltip': 'Seconds of silence in chat before the VTuber starts speaking on her own in Streamer mode.',
    'behavior.cooldown': 'Cooldown Between Replies (sec)',
    'behavior.cooldownTooltip': 'Minimum delay between bot replies so viewers have time to listen and respond.',
    'behavior.maxPerMin': 'Max Replies Per Minute',
    'behavior.maxPerMinTooltip': 'Rate limiter to prevent flooding during high chat activity and control token consumption.',

    // TTS Form
    'tts.enabled': 'TTS Voice Enabled',
    'tts.enabledTooltip': 'Enable speech synthesis. If disabled, the bot will generate replies only as text in logs and chat.',
    'tts.engine': 'TTS Engine',
    'tts.engineTooltip': 'Speech engine. Web Speech uses Windows voices offline. Silero runs locally on GPU. OpenAI and ElevenLabs provide cloud voices.',
    'tts.engineWebspeech': 'Web Speech (Windows system voices, free)',
    'tts.engineSilero': 'Silero (Local neural TTS with GPU acceleration)',
    'tts.engineOpenai': 'OpenAI TTS (Cloud, studio quality, multi-language)',
    'tts.engineElevenlabs': 'ElevenLabs (Cloud, emotional voice cloning)',
    'tts.voice': 'Web Speech Voice (System)',
    'tts.voiceTooltip': 'Speech synthesizer installed in your system. Choose your preferred language synthesizer.',
    'tts.sileroServer': 'Local Silero TTS Server',
    'tts.sileroRunning': '● Server running',
    'tts.sileroStopped': '● Server stopped',
    'tts.sileroAutoInstall': 'When started, the server checks and auto-installs required Python packages and launches the model.',
    'tts.sileroSpeaker': 'Silero Speaker',
    'tts.sileroSpeakerTooltip': 'Silero character voice: Xenia and Baya are female, Eugene and Aidar are male.',
    'tts.sileroEndpoint': 'Silero Endpoint URL',
    'tts.sileroEndpointTooltip': 'Local server address. Default: http://127.0.0.1:5000.',
    'tts.sileroSampleRate': 'Sample Rate',
    'tts.sileroSampleRateTooltip': 'Audio sample rate. 48000 Hz provides clean studio sound on stream without compression artifacts.',
    'tts.openaiEndpoint': 'OpenAI TTS API Endpoint',
    'tts.openaiEndpointTooltip': 'URL for speech synthesis. Default: https://api.openai.com/v1/audio/speech or any compatible service.',
    'tts.openaiApiKey': 'OpenAI TTS API Key',
    'tts.openaiApiKeyTooltip': 'API key for OpenAI TTS. If left blank, the key from the LLM section will be reused.',
    'tts.openaiModel': 'OpenAI TTS Model',
    'tts.openaiModelTooltip': 'tts-1 offers low latency (recommended for streaming); tts-1-hd delivers maximum audio fidelity.',
    'tts.openaiVoice': 'OpenAI TTS Voice',
    'tts.openaiVoiceTooltip': 'Voice timbre: nova, shimmer (female); alloy, echo, fable, onyx (male and neutral voices).',
    'tts.elevenlabsApiKey': 'ElevenLabs API Key (xi-api-key)',
    'tts.elevenlabsApiKeyTooltip': 'ElevenLabs secret API key from your elevenlabs.io account dashboard.',
    'tts.elevenlabsVoiceId': 'Speaker Voice ID',
    'tts.elevenlabsVoiceIdTooltip': 'Voice ID. Default is 21m00Tcm4TlvDq8ikWAM (Rachel). You can paste any cloned or custom voice ID.',
    'tts.elevenlabsModel': 'ElevenLabs Model',
    'tts.elevenlabsModelTooltip': 'eleven_multilingual_v2 provides natural emotional pronunciation in Russian, English, and 28+ languages.',

    // Twitch Form
    'twitch.autoConnect': '1-Click Browser Authorization',
    'twitch.autoHint': 'Click the button below to sign in with Twitch. The OAuth token will be obtained automatically and encrypted in secure storage.',
    'twitch.manualHint': 'Or configure credentials manually. OAuth token is encrypted via Electron safeStorage.',
    'twitch.username': 'Twitch Bot Username',
    'twitch.usernameTooltip': 'Twitch username the bot logs in as. Automatically set when using 1-Click login above.',
    'twitch.channel': 'Stream Channel (to join)',
    'twitch.channelTooltip': 'Twitch channel name (without #) where the bot will listen to chat messages.',
    'twitch.token': 'OAuth Token (Manual)',
    'twitch.tokenTooltip': 'Secret Twitch IRC token (oauth:xxxxx). Encrypted locally on your computer.',

    // Avatar Form
    'avatar.mode': 'Avatar Mode',
    'avatar.modeTooltip': 'Select avatar visualization mode: internal renderer with dedicated transparent window for OBS, or external VTube Studio control via WebSocket.',
    'avatar.disabled': 'Disabled (voice and chat only)',
    'avatar.internal': 'Internal Live2D (Built-in renderer and OBS overlay window)',
    'avatar.vts': 'VTube Studio (Control external program)',
    'avatar.windowTitle': 'Avatar Window for OBS Studio',
    'avatar.windowDesc': 'Dedicated window for OBS capture. Supports alpha transparency and chroma key. Mouth moves in real-time with speech (Lip-Sync).',
    'avatar.method1Title': 'Method 1: Direct Transparency (Recommended)',
    'avatar.method1Step1': 'Click "Open Avatar Window".',
    'avatar.method1Step2': 'In OBS, add a "Window Capture" source.',
    'avatar.method1Step3': 'Select "AI VTuber Avatar Overlay".',
    'avatar.method1Step4': 'Check "Allow Transparency".',
    'avatar.method2Title': 'Method 2: Chroma Key (Green Screen)',
    'avatar.method2Step1': 'In the avatar window top bar, click 🟢 Green Screen.',
    'avatar.method2Step2': 'In OBS, right-click the Window Capture source → "Filters".',
    'avatar.method2Step3': 'In "Effect Filters", click "+" → "Chroma Key".',
    'avatar.method2Step4': 'Key Color Type: Green (the background will instantly vanish).',
    'avatar.bgLabel': 'Default Window Background',
    'avatar.bgTooltip': 'Default background color. Can also be toggled in 1 click directly on the avatar overlay top bar.',
    'avatar.bgTransparent': 'Transparent (Direct Alpha for OBS)',
    'avatar.bgGreen': '🟢 Green Chroma Key (#00FF00)',
    'avatar.bgBlue': '🔵 Blue Screen (#0000FF)',
    'avatar.bgMagenta': '🟣 Magenta Screen (#FF00FF)',
    'avatar.modelLabel': 'Live2D Model File (.model3.json or .zip)',
    'avatar.modelTooltip': 'Click "Select File or ZIP Archive..." to choose a model. If you select a ZIP archive (Booth/Nizima), all files will be extracted and .model3.json auto-detected!',
    'avatar.scale': 'Model Display Scale',
    'avatar.scaleTooltip': 'Display scale of the avatar inside the window. Adjust for your stream resolution.',
    'avatar.vtsUrl': 'VTube Studio WebSocket URL',
    'avatar.vtsUrlTooltip': 'Address of the VTube Studio API. Default: ws://127.0.0.1:8001.',
    'avatar.vtsGuideTitle': 'How to connect VTube Studio:',
    'avatar.vtsGuide1': 'Open VTube Studio on this computer.',
    'avatar.vtsGuide2': 'Open Settings (gear) → Plugin API tab (plug icon).',
    'avatar.vtsGuide3': 'Enable "Start API (allow plugins)". Verify port is 8001.',
    'avatar.vtsGuide4': 'When prompted "Allow plugin?", click Allow.',
    'avatar.vtsGuide5': 'The framework will automatically synchronize the MouthOpen parameter when speaking.',

    // Tester & Logs
    'test.title': 'Test Speech & Chat',
    'test.placeholder': 'Enter a test message...',
    'test.btn': 'Send',
    'logs.title': 'System Event Log',
    'logs.empty': 'Log is empty.',
  },
};

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'ru',
  setLang: () => undefined,
  t: (k) => k,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('aivtuber_lang') as Language | null;
      if (saved === 'ru' || saved === 'en') return saved;
    } catch {
      // ignore
    }
    return 'ru';
  });

  const setLang = (nextLang: Language) => {
    setLangState(nextLang);
    try {
      localStorage.setItem('aivtuber_lang', nextLang);
    } catch {
      // ignore
    }
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = DICTIONARY[lang] || DICTIONARY.ru;
    let text = (dict as Record<string, string>)[key] || (DICTIONARY.ru as Record<string, string>)[key] || key;
    if (params) {
      Object.entries(params).forEach(([paramKey, val]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(val));
      });
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
