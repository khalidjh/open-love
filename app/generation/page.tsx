'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { appConfig } from '@/config/app.config';
import { detectFramework } from '@/lib/templates';
import HeroInput from '@/components/HeroInput';
import { useSpeechDictation } from '@/hooks/useSpeechDictation';
import VoiceWaveform from '@/components/shared/VoiceWaveform';
import SidebarInput from '@/components/app/generation/SidebarInput';
import HeaderBrandKit from '@/components/shared/header/BrandKit/BrandKit';
import { HeaderProvider } from '@/components/shared/header/HeaderContext';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// Import icons from centralized module to avoid Turbopack chunk issues
import { 
  FiFile, 
  FiChevronRight, 
  FiChevronDown,
  FiGithub,
  BsFolderFill, 
  BsFolder2Open,
  SiJavascript, 
  SiReact, 
  SiCss3, 
  SiJson 
} from '@/lib/icons';
import { motion } from 'framer-motion';
import CodeApplicationProgress, { type CodeApplicationState } from '@/components/CodeApplicationProgress';
import DeployStatus, { type DeployState } from '@/components/DeployStatus';

interface SandboxData {
  sandboxId: string;
  url: string;
  [key: string]: any;
}

interface ChatMessage {
  content: string;
  type: 'user' | 'ai' | 'system' | 'file-update' | 'command' | 'error' | 'build';
  timestamp: Date;
  metadata?: {
    scrapedUrl?: string;
    scrapedContent?: any;
    generatedCode?: string;
    appliedFiles?: string[];
    commandType?: 'input' | 'output' | 'error' | 'success';
    brandingData?: any;
    sourceUrl?: string;
  };
}

interface ScrapeData {
  success: boolean;
  content?: string;
  url?: string;
  title?: string;
  source?: string;
  screenshot?: string;
  structured?: any;
  metadata?: any;
  message?: string;
  error?: string;
}

// Turn the user's first prompt into a concise, human-friendly project name.
function deriveProjectName(prompt?: string | null): string {
  if (!prompt) return 'Untitled app';
  let name = prompt.split('\n')[0].trim();
  // Drop leading filler like "build a", "create me an", "make", "please build"...
  name = name.replace(
    /^(please\s+)?(can you\s+)?(build|create|make|design|generate|develop)( me)?( a| an| the)?\s+/i,
    ''
  );
  name = name.replace(/[.!?]+$/, '').trim();
  if (!name) return 'Untitled app';
  // Cap length on a word boundary.
  if (name.length > 50) name = name.slice(0, 50).replace(/\s+\S*$/, '') + '…';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function AISandboxPage() {
  const [sandboxData, setSandboxData] = useState<SandboxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ text: 'Not connected', active: false });
  const [responseArea, setResponseArea] = useState<string[]>([]);
  const [structureContent, setStructureContent] = useState('No sandbox created yet');
  const [promptInput, setPromptInput] = useState('');
  // Chat starts empty — the flow always begins with the user's request.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // Always-current mirror of chatMessages, so async saves aren't stale.
  const chatMessagesDataRef = useRef<ChatMessage[]>([]);
  const [aiChatInput, setAiChatInput] = useState('');
  const [aiEnabled] = useState(true);
  const searchParams = useSearchParams();
  const router = useRouter();
  // Are we landing straight in the builder (restoring a project/sandbox, opening a
  // ?url= target, or arriving from a home-page hand-off) rather than on the empty
  // home screen? Computing this synchronously lets the builder-chrome state below
  // seed correctly on the very first render, avoiding a one-frame flash of the empty
  // "New project" home screen when refreshing a page that already has an active project.
  const enteringBuilderDirectly =
    !!(searchParams.get('project') || searchParams.get('sandbox') || searchParams.get('url')) ||
    (typeof window !== 'undefined' &&
      !!(sessionStorage.getItem('targetUrl') || sessionStorage.getItem('initialBuildPrompt')));
  const [aiModel, setAiModel] = useState(() => {
    const modelParam = searchParams.get('model');
    return appConfig.ai.availableModels.includes(modelParam || '') ? modelParam! : appConfig.ai.defaultModel;
  });
  // Persisted project (DB) this session is editing. Restored from ?project= if present.
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => searchParams.get('project'));
  // Per-project Supabase database (Phase 2), null when the project is frontend-only.
  // Provisioned automatically when a request needs to store data — never surfaced as a user action.
  const [dbInfo, setDbInfo] = useState<{ schema: string; url: string; anonKey: string } | null>(null);
  const currentProjectIdRef = useRef<string | null>(searchParams.get('project'));
  // First user prompt of the session — used to name the project (closure-proof).
  const firstPromptRef = useRef<string | null>(null);
  // Extra context (attached file contents) to feed the auto-build from the home/dashboard box.
  const autoBuildContextRef = useRef<string | null>(null);
  // In-flight guard so concurrent callers (mount createSandbox + the generation
  // path) share a single project-creation request instead of each POSTing a new
  // project row and splitting the session's data across duplicates.
  const ensureProjectIdPromiseRef = useRef<Promise<string | null> | null>(null);
  const [urlOverlayVisible, setUrlOverlayVisible] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlStatus, setUrlStatus] = useState<string[]>([]);
  const [showHomeScreen, setShowHomeScreen] = useState(() => !enteringBuilderDirectly);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['app', 'src', 'src/components']));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [homeScreenFading, setHomeScreenFading] = useState(false);
  const [homeUrlInput, setHomeUrlInput] = useState('');
  const [homeContextInput, setHomeContextInput] = useState('');
  // Free-text "build from description" prompt handed off from the home page
  const [autoBuildPrompt, setAutoBuildPrompt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'generation' | 'preview'>('preview');
  // Builder chrome (Etlaq-style): fullscreen chat vs split view, and the project title.
  // Restoring a saved project/sandbox opens straight into split view, so seed it
  // synchronously to avoid a flash of full-width chat before the mount effect runs.
  const [chatFullscreen, setChatFullscreen] = useState(
    () => !(searchParams.get('project') || searchParams.get('sandbox'))
  );
  // Mobile single-panel chrome: which panel is showing, and the header menu.
  const [mobileView, setMobileView] = useState<'chat' | 'panel'>('chat');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [projectName, setProjectName] = useState('New project');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [codeSearch, setCodeSearch] = useState('');
  const [buildDetailsOpen, setBuildDetailsOpen] = useState(false);
  // Which recorded build steps (in the conversation) are expanded to show their files.
  const [openBuildRecords, setOpenBuildRecords] = useState<Record<number, boolean>>({});
  // True while the workspace is spinning up before the first build actually starts.
  const [preparingBuild, setPreparingBuild] = useState(false);
  // True when the sandbox has gone to sleep/expired (so we can offer a friendly restart).
  const [sandboxExpired, setSandboxExpired] = useState(false);
  const [restartingSandbox, setRestartingSandbox] = useState(false);
  // Chat attachments (files fed to the AI as context; images are preview-only for now).
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; kind: 'image' | 'file'; text?: string; dataUrl?: string }>>([]);
  // Voice dictation: append transcribed speech to the composer, spacing it out.
  const { isSupported: micSupported, isListening: micListening, audioLevel: micLevel, toggle: toggleMic, stop: stopMic } = useSpeechDictation({
    onTranscript: (text) => {
      setAiChatInput((prev) => (prev ? `${prev.replace(/\s+$/, '')} ${text}` : text));
    },
  });
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [showLoadingBackground, setShowLoadingBackground] = useState(false);
  const [urlScreenshot, setUrlScreenshot] = useState<string | null>(null);
  const [isScreenshotLoaded, setIsScreenshotLoaded] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [isPreparingDesign, setIsPreparingDesign] = useState(false);
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [sidebarScrolled, setSidebarScrolled] = useState(false);
  const [screenshotCollapsed, setScreenshotCollapsed] = useState(false);
  const [loadingStage, setLoadingStage] = useState<'gathering' | 'planning' | 'generating' | null>(null);
  const [isStartingNewGeneration, setIsStartingNewGeneration] = useState(false);
  const [sandboxFiles, setSandboxFiles] = useState<Record<string, string>>({});
  // Seeded synchronously so the empty "Generate a new website" input never paints
  // for a frame when we're entering the builder directly (e.g. refreshing a project).
  const [hasInitialSubmission, setHasInitialSubmission] = useState<boolean>(() => enteringBuilderDirectly);
  const [fileStructure, setFileStructure] = useState<string>('');
  
  const [conversationContext, setConversationContext] = useState<{
    scrapedWebsites: Array<{ url: string; content: any; timestamp: Date }>;
    generatedComponents: Array<{ name: string; path: string; content: string }>;
    appliedCode: Array<{ files: string[]; timestamp: Date }>;
    currentProject: string;
    lastGeneratedCode?: string;
  }>({
    scrapedWebsites: [],
    generatedComponents: [],
    appliedCode: [],
    currentProject: '',
    lastGeneratedCode: undefined
  });
  
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const codeDisplayRef = useRef<HTMLDivElement>(null);
  // Covers the iframe with a branded loader so the provider's transient
  // "Sandbox Not Found" 404 never shows through while the app is starting up.
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The iframe is cross-origin, so its onLoad fires even for E2B's raw 404 page —
  // we can't read the content to tell "real app" from "Sandbox Not Found". So we
  // only lift the loader once BOTH are true: the frame has painted something
  // (onLoad), and a server-side health ping has confirmed the URL is actually
  // live. Either signal alone can lie; together they can't.
  const previewPaintedRef = useRef(false);
  const previewHealthyRef = useRef(false);
  const maybeRevealPreview = () => {
    if (!previewPaintedRef.current || !previewHealthyRef.current) return;
    if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
    // Small settle delay so the dev server inside the VM has a beat to paint.
    previewLoadTimerRef.current = setTimeout(() => setPreviewLoading(false), 800);
  };
  
  const [codeApplicationState, setCodeApplicationState] = useState<CodeApplicationState>({
    stage: null
  });

  const [deployStatus, setDeployStatus] = useState<DeployState | null>(null);

  const [generationProgress, setGenerationProgress] = useState<{
    isGenerating: boolean;
    status: string;
    components: Array<{ name: string; path: string; completed: boolean }>;
    currentComponent: number;
    streamedCode: string;
    isStreaming: boolean;
    isThinking: boolean;
    thinkingText?: string;
    thinkingDuration?: number;
    currentFile?: { path: string; content: string; type: string };
    files: Array<{ path: string; content: string; type: string; completed: boolean; edited?: boolean }>;
    lastProcessedPosition: number;
    isEdit?: boolean;
  }>({
    isGenerating: false,
    status: '',
    components: [],
    currentComponent: 0,
    streamedCode: '',
    isStreaming: false,
    isThinking: false,
    files: [],
    lastProcessedPosition: 0
  });

  // Store flag to trigger generation after component mounts
  const [shouldAutoGenerate, setShouldAutoGenerate] = useState(false);

  // Clear old conversation data on component mount and create/restore sandbox
  useEffect(() => {
    let isMounted = true;
    let sandboxCreated = false; // Track if sandbox was created in this effect

    const initializePage = async () => {
      // Prevent double execution in React StrictMode
      if (sandboxCreated) return;
      
      // First check URL parameters (from home page navigation)
      const urlParam = searchParams.get('url');
      const templateParam = searchParams.get('template');
      const detailsParam = searchParams.get('details');
      
      // Then check session storage as fallback
      const storedUrl = urlParam || sessionStorage.getItem('targetUrl');
      const storedStyle = templateParam || sessionStorage.getItem('selectedStyle');
      const storedModel = sessionStorage.getItem('selectedModel');
      const storedInstructions = sessionStorage.getItem('additionalInstructions');
      // Free-text build prompt handed off from the redesigned home page
      const storedBuildPrompt = sessionStorage.getItem('initialBuildPrompt');

      if (storedUrl) {
        // Mark that we have an initial submission since we're loading with a URL
        setHasInitialSubmission(true);
        
        // Clear sessionStorage after reading  
        sessionStorage.removeItem('targetUrl');
        sessionStorage.removeItem('selectedStyle');
        sessionStorage.removeItem('selectedModel');
        sessionStorage.removeItem('additionalInstructions');
        // Note: Don't clear siteMarkdown here, it will be cleared when used
        
        // Set the values in the component state
        setHomeUrlInput(storedUrl);
        setSelectedStyle(storedStyle || 'modern');
        
        // Add details to context if provided
        if (detailsParam) {
          setHomeContextInput(detailsParam);
        } else if (storedStyle && !urlParam) {
          // Only apply stored style if no screenshot URL is provided
          // This prevents unwanted style inheritance when using screenshot search
          const styleNames: Record<string, string> = {
            '1': 'Glassmorphism',
            '2': 'Neumorphism',
            '3': 'Brutalism',
            '4': 'Minimalist',
            '5': 'Dark Mode',
            '6': 'Gradient Rich',
            '7': '3D Depth',
            '8': 'Retro Wave',
            'modern': 'Modern clean and minimalist',
            'playful': 'Fun colorful and playful',
            'professional': 'Corporate professional and sleek',
            'artistic': 'Creative artistic and unique'
          };
          const styleName = styleNames[storedStyle] || storedStyle;
          let contextString = `${styleName} style design`;
          
          // Add additional instructions if provided
          if (storedInstructions) {
            contextString += `. ${storedInstructions}`;
          }
          
          setHomeContextInput(contextString);
        } else if (storedInstructions && !urlParam) {
          // Apply only instructions if no style but instructions are provided
          // and no screenshot URL is provided
          setHomeContextInput(storedInstructions);
        }
        
        if (storedModel) {
          setAiModel(storedModel);
        }
        
        // Skip the home screen and go directly to builder
        setShowHomeScreen(false);
        setHomeScreenFading(false);
        
        // Set flag to auto-trigger generation after component updates
        setShouldAutoGenerate(true);
        
        // Also set autoStart flag for the effect
        sessionStorage.setItem('autoStart', 'true');
      } else if (storedBuildPrompt) {
        // Free-text "describe what to build" flow from the home page
        setHasInitialSubmission(true);
        sessionStorage.removeItem('initialBuildPrompt');
        sessionStorage.removeItem('selectedModel');
        sessionStorage.removeItem('autoStart');

        // Attached file contents (from the home/dashboard box) → fed to the AI as context.
        const storedAtts = sessionStorage.getItem('initialBuildAttachments');
        sessionStorage.removeItem('initialBuildAttachments');
        if (storedAtts) {
          try {
            const atts = JSON.parse(storedAtts) as Array<{ name: string; text: string }>;
            if (atts.length) {
              autoBuildContextRef.current =
                'Attached files (use as reference/context):\n' +
                atts.map((a) => `--- ${a.name} ---\n${a.text}`).join('\n\n');
            }
          } catch {
            // ignore malformed attachment payloads
          }
        }

        if (storedModel) setAiModel(storedModel);

        // Skip the home screen and go straight to the builder chat
        setShowHomeScreen(false);
        setHomeScreenFading(false);

        // Immediately show the user's request + a "setting up" indicator so the
        // screen isn't blank while the sandbox provisions.
        setChatMessages([{ content: storedBuildPrompt, type: 'user', timestamp: new Date() }]);
        setProjectName(deriveProjectName(storedBuildPrompt));
        firstPromptRef.current = storedBuildPrompt;
        setPreparingBuild(true);

        // Trigger the build once the sandbox is ready (see effect below)
        setAutoBuildPrompt(storedBuildPrompt);
      } else if (searchParams.get('project') || searchParams.get('sandbox')) {
        // Opening a saved project or existing sandbox directly — skip the home screen
        // and go straight to the split view (chat left, preview right). The preview
        // shows its own loading state while the sandbox restores, instead of leaving
        // the user staring at a full-width chat until the URL is ready.
        setHasInitialSubmission(true);
        setShowHomeScreen(false);
        setHomeScreenFading(false);
        setChatFullscreen(false);
      }

      // Clear old conversation
      try {
        await fetch('/api/conversation-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear-old', projectId: currentProjectIdRef.current || undefined })
        });
        console.log('[home] Cleared old conversation data on mount');
      } catch (error) {
        console.error('[ai-sandbox] Failed to clear old conversation:', error);
        if (isMounted) {
          addChatMessage('Failed to clear old conversation data.', 'error');
        }
      }
      
      if (!isMounted) return;

      // Check if a saved project or sandbox ID is in the URL
      const projectParam = searchParams.get('project');
      const sandboxIdParam = searchParams.get('sandbox');

      setLoading(true);
      try {
        if (projectParam) {
          console.log('[home] Restoring saved project:', projectParam);
          sandboxCreated = true;
          await restoreProject(projectParam);
        } else if (sandboxIdParam) {
          console.log('[home] Attempting to restore sandbox:', sandboxIdParam);
          // Sandbox reconnection isn't supported yet — create a fresh one
          sandboxCreated = true;
          await createSandbox(true);
        } else {
          console.log('[home] No sandbox in URL, creating new sandbox automatically...');
          sandboxCreated = true;
          await createSandbox(true);
        }
        
        // If we have a URL from the home page, mark for automatic start
        if (storedUrl && isMounted) {
          // We'll trigger the generation after the component is fully mounted
          // and the startGeneration function is defined
          sessionStorage.setItem('autoStart', 'true');
        }
      } catch (error) {
        console.error('[ai-sandbox] Failed to create or restore sandbox:', error);
        if (isMounted) {
          addChatMessage('Failed to create or restore sandbox.', 'error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    initializePage();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount

  // Once there's a live app to preview, drop out of fullscreen chat into the split view.
  useEffect(() => {
    if (sandboxData?.url) setChatFullscreen(false);
  }, [sandboxData?.url]);

  // Keep the messages mirror ref current for stale-free async saves.
  useEffect(() => {
    chatMessagesDataRef.current = chatMessages;
  }, [chatMessages]);

  // Close the project-name dropdown on outside click.
  useEffect(() => {
    if (!projectMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [projectMenuOpen]);

  // Close the attach menu on outside click.
  useEffect(() => {
    if (!attachMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [attachMenuOpen]);

  // When the Code tab is opened, make sure we have the sandbox files loaded...
  useEffect(() => {
    if (
      activeTab === 'generation' &&
      sandboxData &&
      Object.keys(sandboxFiles).length === 0 &&
      generationProgress.files.length === 0
    ) {
      fetchSandboxFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, sandboxData]);

  // ...and auto-select a sensible default file so code shows immediately.
  useEffect(() => {
    if (activeTab !== 'generation' || selectedFile) return;
    const paths =
      generationProgress.files.length > 0
        ? generationProgress.files.map((f) => f.path)
        : Object.keys(sandboxFiles);
    if (!paths.length) return;
    const preferred =
      paths.find((p) => p.endsWith('App.jsx') || p.endsWith('App.tsx')) ||
      paths.find((p) => /\.(jsx|tsx)$/.test(p)) ||
      paths[0];
    setSelectedFile(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, sandboxFiles, generationProgress.files]);

  useEffect(() => {
    // Handle Escape key for home screen
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showHomeScreen) {
        setHomeScreenFading(true);
        setTimeout(() => {
          setShowHomeScreen(false);
          setHomeScreenFading(false);
        }, 500);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHomeScreen]);
  
  // Start capturing screenshot if URL is provided on mount (from home screen)
  useEffect(() => {
    if (!showHomeScreen && homeUrlInput && !urlScreenshot && !isCapturingScreenshot) {
      let screenshotUrl = homeUrlInput.trim();
      if (!screenshotUrl.match(/^https?:\/\//i)) {
        screenshotUrl = 'https://' + screenshotUrl;
      }
      captureUrlScreenshot(screenshotUrl);
    }
  }, [showHomeScreen, homeUrlInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-build from a free-text prompt (home page "describe what to build" flow).
  // Waits for the sandbox to exist so we reuse it instead of creating a second one.
  useEffect(() => {
    if (autoBuildPrompt && sandboxData && !showHomeScreen) {
      const promptToBuild = autoBuildPrompt;
      const extraContext = autoBuildContextRef.current;
      autoBuildContextRef.current = null;
      setAutoBuildPrompt(null);
      console.log('[generation] Auto-building from prompt:', promptToBuild);
      // skipEcho: the user message was already shown before the sandbox was ready.
      sendChatMessage(promptToBuild, extraContext || undefined, true);
    }
  }, [autoBuildPrompt, sandboxData, showHomeScreen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start generation if flagged
  useEffect(() => {
    const autoStart = sessionStorage.getItem('autoStart');
    if (autoStart === 'true' && !showHomeScreen && homeUrlInput) {
      sessionStorage.removeItem('autoStart');
      // Small delay to ensure everything is ready
      setTimeout(() => {
        console.log('[generation] Auto-starting generation for URL:', homeUrlInput);
        startGeneration();
      }, 1000);
    }
  }, [showHomeScreen, homeUrlInput]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    // Only check sandbox status on mount if we don't already have sandboxData
    // AND we're not auto-starting a new generation (which would create a new sandbox)
    const autoStart = sessionStorage.getItem('autoStart');
    if (!sandboxData && autoStart !== 'true') {
      checkSandboxStatus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = chatMessagesRef.current;
    if (!el) return;
    // Ease down to the newest message rather than snapping.
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, generationProgress.isGenerating, preparingBuild]);

  // Auto-trigger generation when flag is set (from home page navigation)
  useEffect(() => {
    if (shouldAutoGenerate && homeUrlInput && !showHomeScreen) {
      // Reset the flag
      setShouldAutoGenerate(false);
      
      // Trigger generation after a short delay to ensure everything is set up
      const timer = setTimeout(() => {
        console.log('[generation] Auto-triggering generation from URL params');
        startGeneration();
      }, 1000);
      
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoGenerate, homeUrlInput, showHomeScreen]);

  const updateStatus = (text: string, active: boolean) => {
    setStatus({ text, active });
  };

  const log = (message: string, type: 'info' | 'error' | 'command' = 'info') => {
    setResponseArea(prev => [...prev, `[${type}] ${message}`]);
  };

  const addChatMessage = (content: string, type: ChatMessage['type'], metadata?: ChatMessage['metadata']) => {
    setChatMessages(prev => {
      // Skip duplicate consecutive system messages
      if (type === 'system' && prev.length > 0) {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage.type === 'system' && lastMessage.content === content) {
          return prev; // Skip duplicate
        }
      }
      return [...prev, { content, type, timestamp: new Date(), metadata }];
    });
  };
  
  const checkAndInstallPackages = async () => {
    // This function is only called when user explicitly requests it
    // Don't show error if no sandbox - it's likely being created
    if (!sandboxData) {
      console.log('[checkAndInstallPackages] No sandbox data available yet');
      return;
    }
    
    // Vite error checking removed - handled by template setup
    addChatMessage('Checking packages... Sandbox is ready with Vite configuration.', 'system');
  };
  
  const handleSurfaceError = (_errors: any[]) => {
    // Function kept for compatibility but Vite errors are now handled by template
    
    // Focus the input
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
    }
  };
  
  const installPackages = async (packages: string[]) => {
    if (!sandboxData) {
      addChatMessage('No active sandbox. Create a sandbox first!', 'system');
      return;
    }
    
    try {
      const response = await fetch('/api/install-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages, projectId: currentProjectIdRef.current || undefined })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to install packages: ${response.statusText}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              switch (data.type) {
                case 'command':
                  // Don't show npm install commands - they're handled by info messages
                  if (!data.command.includes('npm install')) {
                    addChatMessage(data.command, 'command', { commandType: 'input' });
                  }
                  break;
                case 'output':
                  addChatMessage(data.message, 'command', { commandType: 'output' });
                  break;
                case 'error':
                  if (data.message && data.message !== 'undefined') {
                    addChatMessage(data.message, 'command', { commandType: 'error' });
                  }
                  break;
                case 'warning':
                  addChatMessage(data.message, 'command', { commandType: 'output' });
                  break;
                case 'success':
                  addChatMessage(`${data.message}`, 'system');
                  break;
                case 'status':
                  addChatMessage(data.message, 'system');
                  break;
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      addChatMessage(`Failed to install packages: ${error.message}`, 'system');
    }
  };

  // Transparently rebuild a reaped sandbox and swap in the fresh preview URL.
  // Server-side, ensureActiveSandbox replays the generated files so the app comes
  // back where the user left it — the changed URL forces the iframe to reload.
  const recoveringRef = useRef<boolean>(false);
  const recoverSandbox = async (): Promise<boolean> => {
    if (recoveringRef.current) return false;
    recoveringRef.current = true;
    try {
      updateStatus('Restoring preview…', true);
      const res = await fetch('/api/ensure-sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProjectIdRef.current || undefined }),
      });
      const data = await res.json();
      if (data.success && data.sandboxData?.url) {
        setSandboxData(data.sandboxData);
        setSandboxExpired(false);
        // Recovery handed back a live URL — clear the reveal gate. Covers the
        // case where the URL is unchanged (revived in place), so the url-change
        // effect won't re-fire to confirm health on its own.
        previewHealthyRef.current = true;
        maybeRevealPreview();
        updateStatus('Sandbox active', true);
        return true;
      }
      setSandboxExpired(true);
      return false;
    } catch (error) {
      console.error('[recoverSandbox] failed:', error);
      setSandboxExpired(true);
      return false;
    } finally {
      recoveringRef.current = false;
    }
  };

  const checkSandboxStatus = async () => {
    try {
      const pid = currentProjectIdRef.current;
      const response = await fetch(`/api/sandbox-status${pid ? `?projectId=${encodeURIComponent(pid)}` : ''}`);
      const data = await response.json();

      const hadSandbox = !!sandboxDataRef.current;
      if (data.active && data.healthy && data.sandboxData) {
        console.log('[checkSandboxStatus] Setting sandboxData from API:', data.sandboxData);
        setSandboxData(data.sandboxData);
        setSandboxExpired(false);
        // Authoritative "the URL is live" signal — allow the loader to lift.
        previewHealthyRef.current = true;
        maybeRevealPreview();
        updateStatus('Sandbox active', true);
      } else if (hadSandbox && (data.active === false || data.healthy === false)) {
        // We had a live app but the sandbox is gone or unresponsive (reaped TTL).
        // Rebuild it transparently instead of letting the raw 404 show through.
        // Keep the loader down (don't reveal a dead URL) until recovery lands.
        previewHealthyRef.current = false;
        await recoverSandbox();
      } else if (data.active && !data.healthy) {
        // No prior sandbox to restore — just reflect the unhealthy state.
        updateStatus('Sandbox not responding', false);
      } else {
        // Only clear sandboxData if we don't already have it or if we're explicitly checking from a fresh state
        // This prevents clearing sandboxData during normal operation when it should persist
        if (!sandboxData) {
          console.log('[checkSandboxStatus] No existing sandboxData, clearing state');
          setSandboxData(null);
          updateStatus('No sandbox', false);
        } else {
          // Keep existing sandboxData and just update status
          console.log('[checkSandboxStatus] Keeping existing sandboxData, sandbox inactive but data preserved');
          updateStatus('Sandbox status unknown', false);
        }
      }
    } catch (error) {
      console.error('Failed to check sandbox status:', error);
      // Only clear on error if we don't have existing sandboxData
      if (!sandboxData) {
        setSandboxData(null);
        updateStatus('Error', false);
      } else {
        updateStatus('Status check failed', false);
      }
    }
  };

  const sandboxCreationRef = useRef<boolean>(false);
  // Always mirrors the latest sandboxData so async flows (e.g. sendChatMessage) can
  // read it without being bitten by stale closures / the create-in-progress race.
  const sandboxDataRef = useRef<SandboxData | null>(null);
  useEffect(() => {
    sandboxDataRef.current = sandboxData;
  }, [sandboxData]);

  // Poll sandbox health so we can show a friendly "went to sleep" prompt instead
  // of letting the provider's raw 404 show through the preview iframe. Each poll
  // also refreshes the TTL server-side, so an actively-viewed sandbox is never
  // reaped mid-session.
  useEffect(() => {
    if (!sandboxData?.url) return;
    const id = setInterval(() => {
      checkSandboxStatus();
    }, 25000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxData?.url]);

  // Coming back to a backgrounded tab is the classic moment a sandbox has been
  // reaped. Re-verify immediately on focus/visibility instead of waiting up to
  // 25s for the next poll, so recovery kicks in before the user notices.
  useEffect(() => {
    if (!sandboxData?.url) return;
    const onWake = () => {
      if (document.visibilityState === 'visible') checkSandboxStatus();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxData?.url]);

  // Whenever the sandbox URL (re)appears, cover the iframe with the branded
  // loader and re-arm the reveal gate: we don't lift the loader until a health
  // ping confirms this URL is actually live (see maybeRevealPreview). This is
  // what keeps E2B's raw "Sandbox Not Found" 404 from ever flashing through.
  useEffect(() => {
    if (!sandboxData?.url) return;
    previewPaintedRef.current = false;
    previewHealthyRef.current = false;
    setPreviewLoading(true);
    // Verify right away — reveals on healthy, or transparently recovers on dead.
    checkSandboxStatus();
    // Safety valve: never wedge the loader open forever if signals go missing.
    const fallback = setTimeout(() => setPreviewLoading(false), 20000);
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxData?.url]);

  const createSandbox = async (fromHomeScreen = false) => {
    // Prevent duplicate sandbox creation
    if (sandboxCreationRef.current) {
      console.log('[createSandbox] Sandbox creation already in progress, skipping...');
      return null;
    }
    
    sandboxCreationRef.current = true;
    console.log('[createSandbox] Starting sandbox creation...');
    setLoading(true);
    setShowLoadingBackground(true);
    updateStatus('Creating sandbox...', false);
    setResponseArea([]);
    setScreenshotError(null);
    
    try {
      // Auto-detect the framework from the first build request so the sandbox is
      // scaffolded with the right template (Next.js for backend apps, else Vite).
      const framework = detectFramework(firstPromptRef.current);
      // A sandbox belongs to a project — make sure one exists first so the server
      // can key the sandbox by projectId (tenant isolation).
      const projectId = await ensureProjectId();
      if (!projectId) {
        throw new Error('Could not create a project for this sandbox. Please sign in and try again.');
      }
      const response = await fetch('/api/create-ai-sandbox-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framework, projectId })
      });
      
      const data = await response.json();
      console.log('[createSandbox] Response data:', data);
      
      if (data.success) {
        sandboxCreationRef.current = false; // Reset the ref on success
        console.log('[createSandbox] Setting sandboxData from creation:', data);
        setSandboxData(data);
        updateStatus('Sandbox active', true);
        log('Sandbox created successfully!');
        log(`Sandbox ID: ${data.sandboxId}`);
        log(`URL: ${data.url}`);
        
        // Update URL with sandbox ID. Build the params from scratch and re-assert
        // the current project id from the ref — `searchParams` here is a stale
        // closure that predates the `?project=` that ensureProjectId just wrote via
        // router.replace, so relying on it would silently drop the project id and
        // leave the reloaded page unable to restore the saved app.
        const newParams = new URLSearchParams(searchParams.toString());
        if (currentProjectIdRef.current) newParams.set('project', currentProjectIdRef.current);
        newParams.set('sandbox', data.sandboxId);
        newParams.set('model', aiModel);
        router.replace(`/generation?${newParams.toString()}`, { scroll: false });
        
        // Fade out loading background after sandbox loads
        setTimeout(() => {
          setShowLoadingBackground(false);
        }, 3000);
        
        if (data.structure) {
          displayStructure(data.structure);
        }
        
        // Fetch sandbox files after creation
        setTimeout(fetchSandboxFiles, 1000);
        
        // For Vercel sandboxes, Vite is already started during setupViteApp
        // No need to restart it immediately after creation
        // Only restart if there's an actual issue later
        console.log('[createSandbox] Sandbox ready with Vite server running');
        
        // Only add welcome message if not coming from home screen
        if (!fromHomeScreen) {
          addChatMessage(`Sandbox created! ID: ${data.sandboxId}. I now have context of your sandbox and can help you build your app. Just ask me to create components and I'll automatically apply them!

Tip: I automatically detect and install npm packages from your code imports (like react-router-dom, axios, etc.)`, 'system');
        }
        
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.src = data.url;
          }
        }, 100);
        
        // Return the sandbox data so it can be used immediately
        return data;
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error: any) {
      console.error('[createSandbox] Error:', error);
      updateStatus('Error', false);
      log(`Failed to create sandbox: ${error.message}`, 'error');
      addChatMessage(`Failed to create sandbox: ${error.message}`, 'system');
      throw error;
    } finally {
      setLoading(false);
      sandboxCreationRef.current = false; // Reset the ref
    }
  };

  const displayStructure = (structure: any) => {
    if (typeof structure === 'object') {
      setStructureContent(JSON.stringify(structure, null, 2));
    } else {
      setStructureContent(structure || 'No structure available');
    }
  };

  const applyGeneratedCode = async (code: string, isEdit: boolean = false, overrideSandboxData?: SandboxData) => {
    setLoading(true);
    log('Applying AI-generated code...');
    
    try {
      // Show progress component instead of individual messages
      setCodeApplicationState({ stage: 'analyzing' });
      
      // Get pending packages from tool calls
      const pendingPackages = ((window as any).pendingPackages || []).filter((pkg: any) => pkg && typeof pkg === 'string');
      if (pendingPackages.length > 0) {
        console.log('[applyGeneratedCode] Sending packages from tool calls:', pendingPackages);
        // Clear pending packages after use
        (window as any).pendingPackages = [];
      }
      
      // Use streaming endpoint for real-time feedback
      const effectiveSandboxData = overrideSandboxData || sandboxData;
      const response = await fetch('/api/apply-ai-code-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          response: code,
          isEdit: isEdit,
          packages: pendingPackages,
          sandboxId: effectiveSandboxData?.sandboxId, // Pass the sandbox ID to ensure proper connection
          projectId: currentProjectIdRef.current || undefined // enables DB-snapshot recovery if the sandbox died
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to apply code: ${response.statusText}`);
      }
      
      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let finalData: any = null;
      
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              switch (data.type) {
                case 'start':
                  // Don't add as chat message, just update state
                  setCodeApplicationState({ stage: 'analyzing' });
                  break;
                  
                case 'step':
                  // Update progress state based on step
                  if (data.message.includes('Installing') && data.packages) {
                    setCodeApplicationState({ 
                      stage: 'installing', 
                      packages: data.packages 
                    });
                  } else if (data.message.includes('Creating files') || data.message.includes('Applying')) {
                    setCodeApplicationState({ 
                      stage: 'applying',
                      filesGenerated: [] // Files will be populated when complete
                    });
                  }
                  break;
                  
                case 'package-progress':
                  // Handle package installation progress
                  if (data.installedPackages) {
                    setCodeApplicationState(prev => ({ 
                      ...prev,
                      installedPackages: data.installedPackages 
                    }));
                  }
                  break;
                  
                case 'command':
                  // Don't show npm install commands - they're handled by info messages
                  if (data.command && !data.command.includes('npm install')) {
                    addChatMessage(data.command, 'command', { commandType: 'input' });
                  }
                  break;
                  
                case 'success':
                  if (data.installedPackages) {
                    setCodeApplicationState(prev => ({ 
                      ...prev,
                      installedPackages: data.installedPackages 
                    }));
                  }
                  break;
                  
                case 'file-progress':
                  // Skip file progress messages, they're noisy
                  break;
                  
                case 'file-complete':
                  // Could add individual file completion messages if desired
                  break;
                  
                case 'command-progress':
                  addChatMessage(`${data.action} command: ${data.command}`, 'command', { commandType: 'input' });
                  break;
                  
                case 'command-output':
                  addChatMessage(data.output, 'command', { 
                    commandType: data.stream === 'stderr' ? 'error' : 'output' 
                  });
                  break;
                  
                case 'command-complete':
                  if (data.success) {
                    addChatMessage(`Command completed successfully`, 'system');
                  } else {
                    addChatMessage(`Command failed with exit code ${data.exitCode}`, 'system');
                  }
                  break;
                  
                case 'complete':
                  finalData = data;
                  setCodeApplicationState({ stage: 'complete' });
                  // Clear the state after a delay
                  setTimeout(() => {
                    setCodeApplicationState({ stage: null });
                  }, 3000);
                  // Reset loading state when complete
                  setLoading(false);
                  break;
                  
                case 'error':
                  addChatMessage(`Error: ${data.message || data.error || 'Unknown error'}`, 'system');
                  // Reset loading state on error
                  setLoading(false);
                  break;
                  
                case 'warning':
                  addChatMessage(`${data.message}`, 'system');
                  break;
                  
                case 'info':
                  // Show info messages, especially for package installation
                  if (data.message) {
                    addChatMessage(data.message, 'system');
                  }
                  break;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
      
      // Process final data
      if (finalData && finalData.type === 'complete') {
        const data: any = {
          success: true,
          results: finalData.results,
          explanation: finalData.explanation,
          structure: finalData.structure,
          message: finalData.message,
          autoCompleted: finalData.autoCompleted,
          autoCompletedComponents: finalData.autoCompletedComponents,
          warning: finalData.warning,
          missingImports: finalData.missingImports,
          debug: finalData.debug
        };
        
        if (data.success) {
          const { results } = data;
        
        // Log package installation results without duplicate messages
        if (results.packagesInstalled?.length > 0) {
          log(`Packages installed: ${results.packagesInstalled.join(', ')}`);
        }
        
        if (results.filesCreated?.length > 0) {
          log('Files created:');
          results.filesCreated.forEach((file: string) => {
            log(`  ${file}`, 'command');
          });
          
          // Verify files were actually created by refreshing the sandbox if needed
          if (sandboxData?.sandboxId && results.filesCreated.length > 0) {
            // Small delay to ensure files are written
            setTimeout(() => {
              // Force refresh the iframe to show new files
              if (iframeRef.current) {
                iframeRef.current.src = iframeRef.current.src;
              }
            }, 1000);
          }
        }
        
        if (results.filesUpdated?.length > 0) {
          log('Files updated:');
          results.filesUpdated.forEach((file: string) => {
            log(`  ${file}`, 'command');
          });
        }
        
        // Update conversation context with applied code
        setConversationContext(prev => ({
          ...prev,
          appliedCode: [...prev.appliedCode, {
            files: [...(results.filesCreated || []), ...(results.filesUpdated || [])],
            timestamp: new Date()
          }]
        }));
        
        if (results.commandsExecuted?.length > 0) {
          log('Commands executed:');
          results.commandsExecuted.forEach((cmd: string) => {
            log(`  $ ${cmd}`, 'command');
          });
        }
        
        if (results.errors?.length > 0) {
          results.errors.forEach((err: string) => {
            log(err, 'error');
          });
        }
        
        if (data.structure) {
          displayStructure(data.structure);
        }
        
        if (data.explanation) {
          log(data.explanation);
        }
        
        if (data.autoCompleted) {
          log('Auto-generating missing components...', 'command');
          
          if (data.autoCompletedComponents) {
            setTimeout(() => {
              log('Auto-generated missing components:', 'info');
              data.autoCompletedComponents.forEach((comp: string) => {
                log(`  ${comp}`, 'command');
              });
            }, 1000);
          }
        } else if (data.warning) {
          log(data.warning, 'error');
          
          if (data.missingImports && data.missingImports.length > 0) {
            const missingList = data.missingImports.join(', ');
            addChatMessage(
              `Ask me to "create the missing components: ${missingList}" to fix these import errors.`,
              'system'
            );
          }
        }
        
        log('Code applied successfully!');
        console.log('[applyGeneratedCode] Response data:', data);
        console.log('[applyGeneratedCode] Debug info:', data.debug);
        console.log('[applyGeneratedCode] Current sandboxData:', sandboxData);
        console.log('[applyGeneratedCode] Current iframe element:', iframeRef.current);
        console.log('[applyGeneratedCode] Current iframe src:', iframeRef.current?.src);
        
        // Set applying code state for edits to show loading overlay
        // Removed overlay - changes apply directly
        
        // Treat updated files the same as created ones: an edit that only
        // MODIFIES existing files still needs the sandbox manifest refreshed
        // (fetchSandboxFiles) and the snapshot persisted — otherwise the next
        // edit is applied to pre-edit content and this change is lost.
        const changedFiles = [
          ...(results.filesCreated || []),
          ...(results.filesUpdated || []),
        ];
        if (changedFiles.length > 0) {
          setConversationContext(prev => ({
            ...prev,
            appliedCode: [...prev.appliedCode, {
              files: changedFiles,
              timestamp: new Date()
            }]
          }));
          
          // The AI's plain-language summary is the completion message, so we no
          // longer add a technical "Applied N files successfully!" line for new builds.
          if (isEdit) {
            addChatMessage(`Edit applied successfully!`, 'system');
          }
          
          // If there are failed packages, add a message about checking for errors
          if (results.packagesFailed?.length > 0) {
            addChatMessage(`⚠️ Some packages failed to install. Check the error banner above for details.`, 'system');
          }
          
          // Fetch updated file structure
          const updatedFiles = await fetchSandboxFiles();

          // Persist the applied code + chat to the DB (survives sandbox death / reload)
          await persistSnapshot(updatedFiles);

          // Skip automatic package check - it's not needed here and can cause false "no sandbox" messages
          // Packages are already installed during the apply-ai-code-stream process
          
          // Test build to ensure everything compiles correctly
          // Skip build test for now - it's causing errors with undefined activeSandbox
          // The build test was trying to access global.activeSandbox from the frontend,
          // but that's only available in the backend API routes
          console.log('[build-test] Skipping build test - would need API endpoint');
          
          // Force iframe refresh after applying code
          const refreshDelay = appConfig.codeApplication.defaultRefreshDelay; // Allow Vite to process changes
          
          setTimeout(() => {
            const currentSandboxData = effectiveSandboxData;
            if (iframeRef.current && currentSandboxData?.url) {
              console.log('[home] Refreshing iframe after code application...');
              
              // Method 1: Change src with timestamp
              const urlWithTimestamp = `${currentSandboxData.url}?t=${Date.now()}&applied=true`;
              iframeRef.current.src = urlWithTimestamp;
              
              // Method 2: Force reload after a short delay
              setTimeout(() => {
                try {
                  if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.location.reload();
                    console.log('[home] Force reloaded iframe content');
                  }
                } catch (e) {
                  console.log('[home] Could not reload iframe (cross-origin):', e);
                }
                // Reload completed
              }, 1000);
            }
          }, refreshDelay);
          
          // Vite error checking removed - handled by template setup
        }
        
          // Give Vite HMR a moment to detect changes, then ensure refresh
          const currentSandboxData = effectiveSandboxData;
          if (iframeRef.current && currentSandboxData?.url) {
            // Wait for Vite to process the file changes
            // If packages were installed, wait longer for Vite to restart
            const packagesInstalled = results?.packagesInstalled?.length > 0 || data.results?.packagesInstalled?.length > 0;
            const refreshDelay = packagesInstalled ? appConfig.codeApplication.packageInstallRefreshDelay : appConfig.codeApplication.defaultRefreshDelay;
            console.log(`[applyGeneratedCode] Packages installed: ${packagesInstalled}, refresh delay: ${refreshDelay}ms`);
            
            setTimeout(async () => {
            if (iframeRef.current && currentSandboxData?.url) {
              console.log('[applyGeneratedCode] Starting iframe refresh sequence...');
              console.log('[applyGeneratedCode] Current iframe src:', iframeRef.current.src);
              console.log('[applyGeneratedCode] Sandbox URL:', currentSandboxData.url);
              
              // Method 1: Try direct navigation first
              try {
                const urlWithTimestamp = `${currentSandboxData.url}?t=${Date.now()}&force=true`;
                console.log('[applyGeneratedCode] Attempting direct navigation to:', urlWithTimestamp);
                
                // Remove any existing onload handler
                iframeRef.current.onload = null;
                
                // Navigate directly
                iframeRef.current.src = urlWithTimestamp;
                
                // Wait a bit and check if it loaded
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Try to access the iframe content to verify it loaded
                try {
                  const iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
                  if (iframeDoc && iframeDoc.readyState === 'complete') {
                    console.log('[applyGeneratedCode] Iframe loaded successfully');
                    return;
                  }
                } catch {
                  console.log('[applyGeneratedCode] Cannot access iframe content (CORS), assuming loaded');
                  return;
                }
              } catch (e) {
                console.error('[applyGeneratedCode] Direct navigation failed:', e);
              }
              
              // Method 2: Force complete iframe recreation if direct navigation failed
              console.log('[applyGeneratedCode] Falling back to iframe recreation...');
              const parent = iframeRef.current.parentElement;
              const newIframe = document.createElement('iframe');
              
              // Copy attributes
              newIframe.className = iframeRef.current.className;
              newIframe.title = iframeRef.current.title;
              newIframe.allow = iframeRef.current.allow;
              // Copy sandbox attributes
              const sandboxValue = iframeRef.current.getAttribute('sandbox');
              if (sandboxValue) {
                newIframe.setAttribute('sandbox', sandboxValue);
              }
              
              // Remove old iframe
              iframeRef.current.remove();
              
              // Add new iframe
              newIframe.src = `${currentSandboxData.url}?t=${Date.now()}&recreated=true`;
              parent?.appendChild(newIframe);
              
              // Update ref
              (iframeRef as any).current = newIframe;
              
              console.log('[applyGeneratedCode] Iframe recreated with new content');
            } else {
              console.error('[applyGeneratedCode] No iframe or sandbox URL available for refresh');
            }
          }, refreshDelay); // Dynamic delay based on whether packages were installed
        }
        
        } else {
          throw new Error(finalData?.error || 'Failed to apply code');
        }
      } else {
        // If no final data was received, still close loading
        addChatMessage('Code application may have partially succeeded. Check the preview.', 'system');
      }
    } catch (error: any) {
      log(`Failed to apply code: ${error.message}`, 'error');
    } finally {
      setLoading(false);
      // Clear isEdit flag after applying code
      setGenerationProgress(prev => ({
        ...prev,
        isEdit: false
      }));
    }
  };

  const fetchSandboxFiles = async (): Promise<Record<string, string> | null> => {
    if (!sandboxData) return null;

    try {
      const pid = currentProjectIdRef.current;
      const response = await fetch(`/api/get-sandbox-files${pid ? `?projectId=${encodeURIComponent(pid)}` : ''}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSandboxFiles(data.files || {});
          setFileStructure(data.structure || '');
          console.log('[fetchSandboxFiles] Updated file list:', Object.keys(data.files || {}).length, 'files');
          return data.files || {};
        }
      }
    } catch (error) {
      console.error('[fetchSandboxFiles] Error fetching files:', error);
    }
    return null;
  };

  // Ensure a persisted project exists for this session; create one on first save.
  // Uses a ref so it stays correct across awaits within a single generation.
  const ensureProjectId = async (): Promise<string | null> => {
    if (currentProjectIdRef.current) return currentProjectIdRef.current;
    // Coalesce concurrent callers onto one in-flight creation request.
    if (ensureProjectIdPromiseRef.current) return ensureProjectIdPromiseRef.current;
    ensureProjectIdPromiseRef.current = (async () => {
      try {
        const firstUserMsg =
          firstPromptRef.current || chatMessages.find(m => m.type === 'user')?.content;
        const name = deriveProjectName(firstUserMsg);
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Send the raw prompt so the server auto-detects the framework consistently.
          body: JSON.stringify({ name, model: aiModel, prompt: firstUserMsg }),
        });
        const data = await res.json();
        if (data.success && data.project?.id) {
          const id = data.project.id;
          currentProjectIdRef.current = id;
          setCurrentProjectId(id);
          // reflect the project in the URL without a navigation
          const params = new URLSearchParams(searchParams.toString());
          params.set('project', id);
          router.replace(`/generation?${params.toString()}`);
          return id;
        }
      } catch (error) {
        console.error('[ensureProjectId] Failed to create project:', error);
      } finally {
        // Clear the guard so a failed attempt can be retried later.
        ensureProjectIdPromiseRef.current = null;
      }
      return null;
    })();
    return ensureProjectIdPromiseRef.current;
  };

  // Persist the current app state (code snapshot + chat) to the DB.
  const persistSnapshot = async (files: Record<string, string> | null) => {
    if (!files || Object.keys(files).length === 0) return;
    const projectId = await ensureProjectId();
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          messages: chatMessagesDataRef.current
            .filter(m => m.type === 'user' || m.type === 'ai' || m.type === 'system' || m.type === 'build')
            // Build steps carry no text — persist their file list as JSON in `content`.
            .map(m => m.type === 'build'
              ? { role: 'build', content: JSON.stringify(m.metadata?.appliedFiles || []) }
              : { role: m.type, content: m.content }),
          sandboxId: sandboxData?.sandboxId,
          sandboxProvider: (sandboxData as any)?.provider,
        }),
      });
      console.log('[persistSnapshot] Saved project', projectId, Object.keys(files).length, 'files');
    } catch (error) {
      console.error('[persistSnapshot] Failed to save snapshot:', error);
    }
  };

  type DbInfo = { schema: string; url: string; anonKey: string };

  // Silently ensure this project has data storage. Called automatically when a
  // request needs to save data — the user never asks for a "database".
  const ensureDatabase = async (): Promise<DbInfo | null> => {
    if (dbInfo) return dbInfo;
    const projectId = await ensureProjectId();
    if (!projectId) return null;
    addChatMessage('Setting up storage so your app can save data…', 'system');
    try {
      const res = await fetch(`/api/projects/${projectId}/database`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.database?.status === 'ready') {
        const info: DbInfo = { schema: data.database.schema, url: data.database.url, anonKey: data.database.anonKey };
        setDbInfo(info);
        return info;
      }
      throw new Error(data.error || 'setup failed');
    } catch (e: any) {
      console.error('[ensureDatabase] failed:', e);
      return null;
    }
  };

  // Does a generated response need saved data? (AI declared tables, or used the client)
  const responseNeedsDatabase = (generated: string): boolean =>
    /<tables>[\s\S]*?<\/tables>/i.test(generated) ||
    /@supabase\/supabase-js|VITE_SUPABASE_/.test(generated);

  // Silently ensure this project has AI enabled. Called automatically when a
  // generated app wires up the built-in AI — the user never asks for an "API key".
  const aiEnabledRef = useRef(false);
  const ensureAi = async (): Promise<boolean> => {
    if (aiEnabledRef.current) return true;
    const projectId = await ensureProjectId();
    if (!projectId) return false;
    addChatMessage('Enabling AI for your app…', 'system');
    try {
      const res = await fetch(`/api/projects/${projectId}/ai`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.ai?.status === 'ready') {
        aiEnabledRef.current = true;
        return true;
      }
      throw new Error(data.error || 'AI setup failed');
    } catch (e: any) {
      console.error('[ensureAi] failed:', e);
      return false;
    }
  };

  // Did the generated app wire up the built-in AI? (references the injected env vars)
  const responseNeedsAi = (generated: string): boolean => /ETLAQ_AI_(URL|KEY)/.test(generated);

  // Create any tables the response declared, inside the project's storage.
  const createTablesFromResponse = async (generated: string, db: DbInfo | null) => {
    const projectId = currentProjectIdRef.current;
    if (!projectId || !db) return;
    const match = generated.match(/<tables>([\s\S]*?)<\/tables>/i);
    if (!match) return;
    let tables: any;
    try {
      tables = JSON.parse(match[1].trim());
    } catch (e) {
      console.error('[tables] could not parse <tables> block', e);
      return;
    }
    if (!Array.isArray(tables) || tables.length === 0) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/database/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error('[tables] creation failed:', data.error);
      }
    } catch (e: any) {
      console.error('[tables] creation error:', e.message);
    }
  };

  // Load a project's database status (if any) into state; returns it too.
  const loadDbInfo = async (projectId: string): Promise<{ schema: string; url: string; anonKey: string } | null> => {
    try {
      const res = await fetch(`/api/projects/${projectId}/database`);
      const data = await res.json();
      if (data.success && data.database?.status === 'ready') {
        const info = { schema: data.database.schema, url: data.database.url, anonKey: data.database.anonKey };
        setDbInfo(info);
        return info;
      }
    } catch {
      // ignore
    }
    setDbInfo(null);
    return null;
  };

  // Restore a saved project: rehydrate chat, create a fresh sandbox, and write
  // the last saved files back into it so the preview shows the real app.
  const restoreProject = async (projectId: string): Promise<boolean> => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}`);
      const data = await res.json();
      if (!data.success) {
        addChatMessage('Could not load this project.', 'error');
        return false;
      }

      // Reflect the saved project name in the header title
      if (data.project?.name) {
        setProjectName(data.project.name);
        firstPromptRef.current = data.project.name;
      }

      // Rehydrate the "Published" card from the durably-saved deploy URL (the
      // source of truth on the project row), so the live URL + its copy/open
      // actions survive a page reload instead of vanishing with local state.
      if (data.project?.deployUrl) {
        setDeployStatus({ stage: 'published', url: data.project.deployUrl });
      }

      // Rehydrate chat history
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        setChatMessages(data.messages.map((m: any) => {
          // Build steps were persisted with their file list JSON-encoded in `content`.
          if (m.role === 'build') {
            let files: string[] = [];
            try { files = JSON.parse(m.content); } catch { files = []; }
            return {
              content: '',
              type: 'build' as ChatMessage['type'],
              metadata: { appliedFiles: files },
              timestamp: new Date(m.createdAt || Date.now()),
            };
          }
          return {
            content: m.content,
            type: (['user', 'ai', 'system'].includes(m.role) ? m.role : 'system') as ChatMessage['type'],
            timestamp: new Date(m.createdAt || Date.now()),
          };
        }));
      }

      // Always need a fresh sandbox
      await createSandbox(true);

      const fileCount = Object.keys(data.files || {}).length;
      if (fileCount === 0) {
        // Nothing saved yet — just leave the fresh scaffold
        return true;
      }

      // Write the saved files into the new sandbox + reinstall deps + restart Vite
      const restoreRes = await fetch(`/api/projects/${projectId}/restore`, { method: 'POST' });
      const restoreData = await restoreRes.json();
      if (!restoreData.success) {
        addChatMessage(`Restore failed: ${restoreData.error}`, 'error');
        return false;
      }

      await fetchSandboxFiles();

      // If this project has a database, re-inject its creds into the fresh sandbox
      const db = await loadDbInfo(projectId);
      if (db) {
        await fetch(`/api/projects/${projectId}/database`, { method: 'POST' });
      }

      // Nudge the preview to reload now that files are in place
      if (iframeRef.current) {
        // eslint-disable-next-line no-self-assign
        iframeRef.current.src = iframeRef.current.src;
      }
      return true;
    } catch (e: any) {
      addChatMessage(`Restore error: ${e.message}`, 'error');
      return false;
    } finally {
      setLoading(false);
    }
  };
  
//   const restartViteServer = async () => {
//     try {
//       addChatMessage('Restarting Vite dev server...', 'system');
//       
//       const response = await fetch('/api/restart-vite', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' }
//       });
//       
//       if (response.ok) {
//         const data = await response.json();
//         if (data.success) {
//           addChatMessage('✓ Vite dev server restarted successfully!', 'system');
//           
//           // Refresh the iframe after a short delay
//           setTimeout(() => {
//             if (iframeRef.current && sandboxData?.url) {
//               iframeRef.current.src = `${sandboxData.url}?t=${Date.now()}`;
//             }
//           }, 2000);
//         } else {
//           addChatMessage(`Failed to restart Vite: ${data.error}`, 'error');
//         }
//       } else {
//         addChatMessage('Failed to restart Vite server', 'error');
//       }
//     } catch (error) {
//       console.error('[restartViteServer] Error:', error);
//       addChatMessage(`Error restarting Vite: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
//     }
//   };

//   const applyCode = async () => {
//     const code = promptInput.trim();
//     if (!code) {
//       log('Please enter some code first', 'error');
//       addChatMessage('No code to apply. Please generate code first.', 'system');
//       return;
//     }
//     
//     // Prevent double clicks
//     if (loading) {
//       console.log('[applyCode] Already loading, skipping...');
//       return;
//     }
//     
//     // Determine if this is an edit based on whether we have applied code before
//     const isEdit = conversationContext.appliedCode.length > 0;
//     await applyGeneratedCode(code, isEdit);
//   };

  const extToType = (p: string) => {
    const e = p.split('.').pop()?.toLowerCase();
    if (e === 'css') return 'css';
    if (e === 'json') return 'json';
    if (e === 'html') return 'html';
    if (['js', 'jsx', 'ts', 'tsx'].includes(e || '')) return 'javascript';
    return 'text';
  };

  // Recreate a fresh sandbox and restore the app after the preview goes to sleep.
  const restartSandbox = async () => {
    if (restartingSandbox) return;
    setRestartingSandbox(true);
    try {
      const pid = currentProjectIdRef.current;
      if (pid) {
        await restoreProject(pid);
      } else {
        await createSandbox(true);
        if (conversationContext.lastGeneratedCode) {
          await reapplyLastGeneration();
        }
      }
      setSandboxExpired(false);
      if (iframeRef.current && sandboxDataRef.current?.url) {
        iframeRef.current.src = `${sandboxDataRef.current.url}?t=${Date.now()}`;
      }
    } catch {
      // Leave the friendly restart prompt in place so the user can retry.
    } finally {
      setRestartingSandbox(false);
    }
  };

  // Read picked files: images -> data URL (preview only), text/code -> content (fed to AI).
  const handleAttachFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file, i) => {
      const isImage = file.type.startsWith('image/');
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            id: `${file.name}-${prev.length}-${i}`,
            name: file.name,
            kind: isImage ? 'image' : 'file',
            text: isImage ? undefined : result,
            dataUrl: isImage ? result : undefined,
          },
        ]);
      };
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  };

  // Send the composer message, feeding any attached file contents to the AI as context.
  const handleComposerSend = () => {
    // Don't accept new requests while a build is in flight.
    if (generationProgress.isGenerating || preparingBuild) return;
    const text = aiChatInput.trim();
    if (!text && attachments.length === 0) return;
    const fileAtts = attachments.filter((a) => a.kind === 'file');
    const extra = fileAtts.length
      ? 'Attached files (use as reference/context):\n' +
        fileAtts.map((a) => `--- ${a.name} ---\n${a.text}`).join('\n\n')
      : '';
    const display = text || (fileAtts.length ? 'Use the attached file(s).' : 'See the attached image(s).');
    setAiChatInput('');
    setAttachments([]);
    setAttachMenuOpen(false);
    sendChatMessage(display, extra || undefined);
  };

  const renderMainContent = () => {
    // Files to show in the Code tab: prefer freshly generated files, otherwise
    // fall back to the real files in the sandbox (e.g. a restored project).
    const codeFiles: Array<{ path: string; content: string; type: string; edited?: boolean }> =
      generationProgress.files.length > 0
        ? (generationProgress.files as any)
        : Object.entries(sandboxFiles).map(([path, content]) => ({
            path,
            content: content as string,
            type: extToType(path),
            edited: false,
          }));

    if (activeTab === 'generation' && (generationProgress.isGenerating || codeFiles.length > 0)) {
      return (
        /* Generation Tab Content — dark editor */
        <div className="absolute inset-0 flex overflow-hidden bg-[#1b1b1f]">
          {/* File Explorer - Hide during edits */}
          {!generationProgress.isEdit && (
            <div className="w-[248px] border-r border-[#2a2a30] bg-[#161619] flex flex-col flex-shrink-0">
            {/* Search */}
            <div className="p-10 border-b border-[#2a2a30]">
              <div className="flex items-center gap-8 rounded-8 bg-[#0f0f12] border border-[#2a2a30] px-10 py-7">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="shrink-0 text-[#6b6b76]">
                  <circle cx="8.5" cy="8.5" r="5.5" strokeWidth="1.5" />
                  <path d="M12.5 12.5L16.5 16.5" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  value={codeSearch}
                  onChange={(e) => setCodeSearch(e.target.value)}
                  placeholder="Search code"
                  className="w-full bg-transparent text-[13px] text-[#d4d4d8] placeholder:text-[#6b6b76] focus:outline-none"
                />
              </div>
            </div>

            {/* File Tree */}
            <div className="flex-1 overflow-y-auto py-8 px-8 scrollbar-hide">
              <div className="text-sm">
                {(() => {
                  const q = codeSearch.trim().toLowerCase();
                  const fileTree: { [key: string]: Array<{ name: string; edited?: boolean }> } = {};
                  codeFiles
                    .filter((file) => !q || file.path.toLowerCase().includes(q))
                    .forEach((file) => {
                      const parts = file.path.split('/');
                      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                      const fileName = parts[parts.length - 1];
                      if (!fileTree[dir]) fileTree[dir] = [];
                      fileTree[dir].push({ name: fileName, edited: file.edited || false });
                    });

                  return Object.entries(fileTree).map(([dir, files]) => (
                    <div key={dir} className="mb-2">
                      {dir && (
                        <div
                          className="flex items-center gap-6 py-4 px-8 rounded-6 hover:bg-[#22222a] cursor-pointer text-[#9a9aa5]"
                          onClick={() => toggleFolder(dir)}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-[#6b6b76] transition-transform ${expandedFolders.has(dir) ? 'rotate-90' : ''}`}>
                            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="text-[13px]">{dir.split('/').pop()}</span>
                        </div>
                      )}
                      {(!dir || expandedFolders.has(dir)) && (
                        <div className={dir ? 'ml-14' : ''}>
                          {files.sort((a, b) => a.name.localeCompare(b.name)).map((fileInfo) => {
                            const fullPath = dir ? `${dir}/${fileInfo.name}` : fileInfo.name;
                            const isSelected = selectedFile === fullPath;
                            return (
                              <div
                                key={fullPath}
                                className={`flex items-center gap-8 py-5 px-8 rounded-6 cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-[#2b2740] text-white ring-1 ring-[#6147D4]/50'
                                    : 'text-[#c4c4cc] hover:bg-[#22222a]'
                                }`}
                                onClick={() => handleFileClick(fullPath)}
                              >
                                {getFileIcon(fileInfo.name)}
                                <span className={`text-[13px] flex items-center gap-4 truncate ${isSelected ? 'font-medium' : ''}`}>
                                  {fileInfo.name}
                                  {fileInfo.edited && (
                                    <span className="text-[10px] px-4 rounded-4 bg-[#6147D4] text-white">✓</span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
          )}
          
          {/* Code Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Thinking Mode Display - Only show during active generation */}
            {generationProgress.isGenerating && (generationProgress.isThinking || generationProgress.thinkingText) && (
              <div className="px-6 pb-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-purple-600 font-medium flex items-center gap-2">
                    {generationProgress.isThinking ? (
                      <>
                        <div className="w-3 h-3 bg-purple-600 rounded-full animate-pulse" />
                        AI is thinking...
                      </>
                    ) : (
                      <>
                        <span className="text-purple-600">✓</span>
                        Thought for {generationProgress.thinkingDuration || 0} seconds
                      </>
                    )}
                  </div>
                </div>
                {generationProgress.thinkingText && (
                  <div className="bg-[#161619] border border-[#2a2a30] rounded-12 p-14 max-h-48 overflow-y-auto scrollbar-hide">
                    <pre className="text-xs font-mono text-[#9a9aa5] whitespace-pre-wrap">
                      {generationProgress.thinkingText}
                    </pre>
                  </div>
                )}
              </div>
            )}
            
            {/* Live Code Display */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#1e1e22]">
              <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide" ref={codeDisplayRef}>
                {/* Show selected file if one is selected */}
                {selectedFile ? (
                  <div>
                    {/* Tab bar */}
                    <div className="sticky top-0 z-10 flex items-stretch border-b border-[#2a2a30] bg-[#161619]">
                      <div className="flex items-center gap-8 border-r border-[#2a2a30] bg-[#1e1e22] px-14 py-9 text-[13px] text-white">
                        {getFileIcon(selectedFile)}
                        <span className="font-mono">{selectedFile.split('/').pop()}</span>
                        <button
                          onClick={() => setSelectedFile(null)}
                          className="ml-4 rounded-4 p-2 text-[#8b8b96] transition-colors hover:bg-[#2a2a30] hover:text-white"
                          title="Close file"
                        >
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Editor pane */}
                    <SyntaxHighlighter
                      language={(() => {
                        const ext = selectedFile.split('.').pop()?.toLowerCase();
                        if (ext === 'css') return 'css';
                        if (ext === 'json') return 'json';
                        if (ext === 'html') return 'html';
                        return 'jsx';
                      })()}
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        padding: '0.75rem 0',
                        fontSize: '0.8125rem',
                        background: 'transparent',
                      }}
                      showLineNumbers={true}
                      lineNumberStyle={{ minWidth: '3.25em', paddingRight: '1rem', color: '#4b4b55' }}
                    >
                      {(() => {
                        // Find the file content from generated or sandbox files
                        const file = codeFiles.find(f => f.path === selectedFile);
                        return file?.content || '// File content will appear here';
                      })()}
                    </SyntaxHighlighter>
                  </div>
                ) : /* If no files parsed yet, show loading or raw stream */
                codeFiles.length === 0 && !generationProgress.currentFile ? (
                  generationProgress.isThinking ? (
                    // Beautiful loading state while thinking
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="mb-8 relative">
                          <div className="w-48 h-48 mx-auto">
                            <div className="absolute inset-0 border-8 border-gray-800 rounded-full"></div>
                            <div className="absolute inset-0 border-8 border-green-500 rounded-full animate-spin border-t-transparent"></div>
                          </div>
                        </div>
                        <h3 className="text-xl font-medium text-white mb-2">AI is analyzing your request</h3>
                        <p className="text-gray-400 text-sm">{generationProgress.status || 'Preparing to generate code...'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#1e1e22] border border-[#2a2a30] rounded-lg overflow-hidden">
                      <div className="px-14 py-9 bg-[#161619] text-[#d4d4d8] border-b border-[#2a2a30] flex items-center justify-between">
                        <div className="flex items-center gap-8">
                          <div className="w-16 h-16 border-2 border-[#6147D4] border-t-transparent rounded-full animate-spin" />
                          <span className="font-mono text-[13px]">Streaming code…</span>
                        </div>
                      </div>
                      <div className="p-4 bg-transparent rounded">
                        <SyntaxHighlighter
                          language="jsx"
                          style={vscDarkPlus}
                          customStyle={{
                            margin: 0,
                            padding: '1rem',
                            fontSize: '0.875rem',
                            background: 'transparent',
                          }}
                          showLineNumbers={true}
                        >
                          {generationProgress.streamedCode || 'Starting code generation...'}
                        </SyntaxHighlighter>
                        <span className="inline-block w-3 h-5 bg-orange-400 ml-1 animate-pulse" />
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-4">
                    {/* Show current file being generated */}
                    {generationProgress.currentFile && (
                      <div className="bg-black border-2 border-gray-400 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 bg-[#36322F] text-white flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-16 border-2 border-[#6147D4] border-t-transparent rounded-full animate-spin" />
                            <span className="font-mono text-sm">{generationProgress.currentFile.path}</span>
                            <span className={`px-2 py-0.5 text-xs rounded ${
                              generationProgress.currentFile.type === 'css' ? 'bg-blue-600 text-white' :
                              generationProgress.currentFile.type === 'javascript' ? 'bg-yellow-600 text-white' :
                              generationProgress.currentFile.type === 'json' ? 'bg-green-600 text-white' :
                              'bg-gray-200 text-gray-700'
                            }`}>
                              {generationProgress.currentFile.type === 'javascript' ? 'JSX' : generationProgress.currentFile.type.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div className="bg-gray-900 border border-gray-700 rounded">
                          <SyntaxHighlighter
                            language={
                              generationProgress.currentFile.type === 'css' ? 'css' :
                              generationProgress.currentFile.type === 'json' ? 'json' :
                              generationProgress.currentFile.type === 'html' ? 'html' :
                              'jsx'
                            }
                            style={vscDarkPlus}
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.75rem',
                              background: 'transparent',
                            }}
                            showLineNumbers={true}
                          >
                            {generationProgress.currentFile.content}
                          </SyntaxHighlighter>
                          <span className="inline-block w-3 h-4 bg-orange-400 ml-4 mb-4 animate-pulse" />
                        </div>
                      </div>
                    )}
                    
                    {/* Show completed files */}
                    {generationProgress.files.map((file, idx) => (
                      <div key={idx} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 bg-[#36322F] text-white flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-green-500">✓</span>
                            <span className="font-mono text-sm">{file.path}</span>
                          </div>
                          <span className={`px-2 py-0.5 text-xs rounded ${
                            file.type === 'css' ? 'bg-blue-600 text-white' :
                            file.type === 'javascript' ? 'bg-yellow-600 text-white' :
                            file.type === 'json' ? 'bg-green-600 text-white' :
                            'bg-gray-200 text-gray-700'
                          }`}>
                            {file.type === 'javascript' ? 'JSX' : file.type.toUpperCase()}
                          </span>
                        </div>
                        <div className="bg-gray-900 border border-gray-700 max-h-48 overflow-y-auto scrollbar-hide">
                          <SyntaxHighlighter
                            language={
                              file.type === 'css' ? 'css' :
                              file.type === 'json' ? 'json' :
                              file.type === 'html' ? 'html' :
                              'jsx'
                            }
                            style={vscDarkPlus}
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.75rem',
                              background: 'transparent',
                            }}
                            showLineNumbers={true}
                            wrapLongLines={true}
                          >
                            {file.content}
                          </SyntaxHighlighter>
                        </div>
                      </div>
                    ))}
                    
                    {/* Show remaining raw stream if there's content after the last file (only while actively streaming) */}
                    {generationProgress.isStreaming && !generationProgress.currentFile && generationProgress.streamedCode.length > 0 && (
                      <div className="bg-black border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 bg-[#36322F] text-white flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-16 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                            <span className="font-mono text-sm">Processing...</span>
                          </div>
                        </div>
                        <div className="bg-gray-900 border border-gray-700 rounded">
                          <SyntaxHighlighter
                            language="jsx"
                            style={vscDarkPlus}
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.75rem',
                              background: 'transparent',
                            }}
                            showLineNumbers={false}
                          >
                            {(() => {
                              // Show only the tail of the stream after the last file
                              const lastFileEnd = generationProgress.files.length > 0 
                                ? generationProgress.streamedCode.lastIndexOf('</file>') + 7
                                : 0;
                              let remainingContent = generationProgress.streamedCode.slice(lastFileEnd).trim();
                              
                              // Remove explanation tags and content
                              remainingContent = remainingContent.replace(/<explanation>[\s\S]*?<\/explanation>/g, '').trim();

                              // Remove Morph fast-apply <edit> blocks (applied separately, not rendered as files)
                              remainingContent = remainingContent.replace(/<edit[\s\S]*?<\/edit>/g, '').trim();

                              // Remove <tables> DB spec blocks (handled separately, not rendered as code)
                              remainingContent = remainingContent.replace(/<tables>[\s\S]*?<\/tables>/g, '').trim();

                              // If only whitespace or nothing left, show loading message
                              // Use "Loading sandbox..." instead of "Waiting for next file..." for better UX
                              return remainingContent || 'Loading sandbox...';
                            })()}
                          </SyntaxHighlighter>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Progress indicator */}
            {generationProgress.components.length > 0 && (
              <div className="mx-6 mb-6">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-300"
                    style={{
                      width: `${(generationProgress.currentComponent / Math.max(generationProgress.components.length, 1)) * 100}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      );
    } else if (activeTab === 'preview') {
      // Show loading state for initial generation or when starting a new generation with existing sandbox
      const isInitialGeneration = !sandboxData?.url && (urlScreenshot || isCapturingScreenshot || isPreparingDesign || loadingStage);
      const isNewGenerationWithSandbox = isStartingNewGeneration && sandboxData?.url;
      const shouldShowLoadingOverlay = (isInitialGeneration || isNewGenerationWithSandbox) && 
        (loading || generationProgress.isGenerating || isPreparingDesign || loadingStage || isCapturingScreenshot || isStartingNewGeneration);
      
      if (isInitialGeneration || isNewGenerationWithSandbox) {
        return (
          <div className="relative w-full h-full bg-gray-900">
            {/* Screenshot as background when available */}
            {urlScreenshot && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img 
                src={urlScreenshot} 
                alt="Website preview" 
                className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                style={{ 
                  opacity: isScreenshotLoaded ? 1 : 0,
                  willChange: 'opacity'
                }}
                onLoad={() => setIsScreenshotLoaded(true)}
                loading="eager"
              />
            )}
            
            {/* Loading overlay - only show when actively processing initial generation */}
            {shouldShowLoadingOverlay && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center backdrop-blur-sm">
                {/* Loading animation with skeleton */}
                <div className="text-center max-w-md">
                  {/* Animated skeleton lines */}
                  <div className="mb-6 space-y-3">
                    <div className="h-2 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded animate-pulse" 
                         style={{ animationDuration: '1.5s', animationDelay: '0s' }} />
                    <div className="h-2 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded animate-pulse w-4/5 mx-auto" 
                         style={{ animationDuration: '1.5s', animationDelay: '0.2s' }} />
                    <div className="h-2 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded animate-pulse w-3/5 mx-auto" 
                         style={{ animationDuration: '1.5s', animationDelay: '0.4s' }} />
                  </div>
                  
                  {/* Status text */}
                  <p className="text-white text-lg font-medium">
                    {isCapturingScreenshot ? 'Analyzing website...' :
                     isPreparingDesign ? 'Preparing design...' :
                     generationProgress.isGenerating ? 'Generating code...' :
                     'Loading...'}
                  </p>
                  
                  {/* Subtle progress hint */}
                  <p className="text-white/60 text-sm mt-2">
                    {isCapturingScreenshot ? 'Taking a screenshot of the site' :
                     isPreparingDesign ? 'Understanding the layout and structure' :
                     generationProgress.isGenerating ? 'Writing React components' :
                     'Please wait...'}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      }
      
      // Show sandbox iframe - keep showing during edits, only hide during initial loading
      if (sandboxData?.url) {
        return (
          <div
            className={`relative w-full h-full transition-colors duration-300 ${
              previewDevice === 'mobile' ? 'flex items-center justify-center bg-[#f3f0fa] p-16' : ''
            }`}
          >
            <iframe
              ref={iframeRef}
              src={sandboxData.url}
              onLoad={() => {
                // The frame painted *something* — but cross-origin, we can't tell
                // whether it's the real app or E2B's 404. Mark it painted and let
                // the reveal gate decide; it only lifts once a health ping has
                // also confirmed the URL is live.
                previewPaintedRef.current = true;
                maybeRevealPreview();
              }}
              className={
                previewDevice === 'mobile'
                  ? 'h-full max-h-[800px] w-[390px] rounded-24 border border-[#e7e3f0] bg-white transition-all duration-300'
                  : 'w-full h-full border-none transition-all duration-300'
              }
              title="Etlaq Sandbox"
              allow="clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />

            {/* Branded loader — hides the provider's transient "Sandbox Not Found" 404 */}
            {previewLoading && !sandboxExpired && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#fbfafd] p-24">
                <div className="text-center">
                  <div className="mx-auto mb-16 h-40 w-40 animate-spin rounded-full border-[3px] border-[#e2ddf0] border-t-[#6147D4]" />
                  <h3 className="text-[16px] font-semibold text-[#191622]">Starting your preview…</h3>
                  <p className="mt-6 text-[13px] text-[#8b8798]">This takes a few seconds.</p>
                </div>
              </div>
            )}

            {/* Friendly "preview went to sleep" overlay — replaces the raw provider 404 */}
            {sandboxExpired && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#fbfafd] p-24">
                <div className="max-w-[360px] text-center">
                  <div className="mx-auto mb-16 flex h-48 w-48 items-center justify-center rounded-full bg-[#f0ecfb] text-[#6147D4]">
                    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-[18px] font-semibold text-[#191622]">Your preview went to sleep</h3>
                  <p className="mt-8 text-[14px] leading-relaxed text-[#6b6577]">
                    Previews pause after a while of inactivity. Restart it to see your app again — your work is saved.
                  </p>
                  <button
                    onClick={restartSandbox}
                    disabled={restartingSandbox}
                    className="mt-20 inline-flex items-center gap-8 rounded-12 bg-[#6147D4] px-20 py-10 text-[14px] font-semibold text-white transition-colors hover:bg-[#5238c0] disabled:opacity-60"
                  >
                    {restartingSandbox ? (
                      <>
                        <div className="h-14 w-14 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Restarting…
                      </>
                    ) : (
                      'Restart preview'
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Package installation overlay - shows when installing packages or applying code */}
            {codeApplicationState.stage && codeApplicationState.stage !== 'complete' && (
              <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex items-center justify-center z-10">
                <div className="text-center max-w-md">
                  <div className="mb-6">
                    {/* Animated icon based on stage */}
                    {codeApplicationState.stage === 'installing' ? (
                      <div className="w-16 h-16 mx-auto">
                        <svg className="w-full h-full animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </div>
                    ) : null}
                  </div>
                  
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {codeApplicationState.stage === 'analyzing' && 'Analyzing code...'}
                    {codeApplicationState.stage === 'installing' && 'Installing packages...'}
                    {codeApplicationState.stage === 'applying' && 'Applying changes...'}
                  </h3>
                  
                  {/* Package list during installation */}
                  {codeApplicationState.stage === 'installing' && codeApplicationState.packages && (
                    <div className="mb-4">
                      <div className="flex flex-wrap gap-2 justify-center">
                        {codeApplicationState.packages.map((pkg, index) => (
                          <span 
                            key={index}
                            className={`px-2 py-1 text-xs rounded-full transition-all ${
                              codeApplicationState.installedPackages?.includes(pkg)
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {pkg}
                            {codeApplicationState.installedPackages?.includes(pkg) && (
                              <span className="ml-1">✓</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Files being generated */}
                  {codeApplicationState.stage === 'applying' && codeApplicationState.filesGenerated && (
                    <div className="text-sm text-gray-600">
                      Creating {codeApplicationState.filesGenerated.length} files...
                    </div>
                  )}
                  
                  <p className="text-sm text-gray-500 mt-2">
                    {codeApplicationState.stage === 'analyzing' && 'Parsing generated code and detecting dependencies...'}
                    {codeApplicationState.stage === 'installing' && 'This may take a moment while npm installs the required packages...'}
                    {codeApplicationState.stage === 'applying' && 'Writing files to your sandbox environment...'}
                  </p>
                </div>
              </div>
            )}
            
            {/* Show a subtle indicator when code is being edited/generated */}
            {generationProgress.isGenerating && generationProgress.isEdit && !codeApplicationState.stage && (
              <div className="absolute top-4 right-4 inline-flex items-center gap-2 px-3 py-1.5 bg-black/80 backdrop-blur-sm rounded-lg">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-white text-xs font-medium">Generating code...</span>
              </div>
            )}
            
            {/* Refresh button */}
            <button
              onClick={() => {
                if (iframeRef.current && sandboxData?.url) {
                  console.log('[Manual Refresh] Forcing iframe reload...');
                  const newSrc = `${sandboxData.url}?t=${Date.now()}&manual=true`;
                  iframeRef.current.src = newSrc;
                }
              }}
              className="absolute bottom-4 right-4 bg-white/90 hover:bg-white text-gray-700 p-2 rounded-lg transition-all duration-200 hover:scale-105"
              title="Refresh sandbox"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        );
      }
      
      // Default state when no sandbox and no screenshot
      return (
        <div className="flex items-center justify-center h-full bg-white text-[#6b6577]">
          {screenshotError ? (
            <div className="text-center">
              <p className="mb-8 text-[15px] text-[#191622]">Failed to capture screenshot</p>
              <p className="text-[13px] text-[#8b8798]">{screenshotError}</p>
            </div>
          ) : sandboxData || loading ? (
            <div className="text-center">
              <div className="w-32 h-32 border-2 border-[#e2ddf0] border-t-[#6147D4] rounded-full animate-spin mx-auto mb-12" />
              <p className="text-[14px] text-[#8b8798]">
                {sandboxData ? 'Loading preview…' : 'Setting up your workspace…'}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-[19px] font-semibold text-[#191622]">Your app will live here</p>
              <p className="mt-6 text-[14px] text-[#8b8798]">Ask Etlaq to build it</p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const sendChatMessage = async (overrideMessage?: string, extraContext?: string, skipEcho?: boolean) => {
    const message = (overrideMessage ?? aiChatInput).trim();
    if (!message) return;
    // The workspace is (or is about to be) building — drop the "setting up" placeholder.
    setPreparingBuild(false);
    // What the AI actually receives (message shown in chat + any attached file context).
    const apiPrompt = extraContext ? `${message}\n\n${extraContext}` : message;
    
    if (!aiEnabled) {
      addChatMessage('AI is disabled. Please enable it first.', 'system');
      return;
    }
    
    // Skip echoing the user message when it was already shown (auto-build pre-render).
    if (!skipEcho) addChatMessage(message, 'user');
    setAiChatInput('');
    // Remember the first prompt so the project gets a meaningful name.
    if (!firstPromptRef.current) {
      firstPromptRef.current = message;
      const derivedName = deriveProjectName(message);
      setProjectName(derivedName);
      // The project row is usually created at mount (before any prompt) and is
      // therefore named "Untitled app". Now that we know the user's first request,
      // rename it in the DB so a reload shows the real name. Resolve the id first
      // (single-flight, so no duplicate project) to stay robust even if creation
      // is still in flight when the user submits.
      ensureProjectId().then((pid) => {
        if (!pid) return;
        fetch(`/api/projects/${pid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: derivedName }),
        }).catch(() => { /* non-critical: the header already shows the name */ });
      });
    }

    // Check for special commands
    const lowerMessage = message.toLowerCase().trim();
    if (lowerMessage === 'check packages' || lowerMessage === 'install packages' || lowerMessage === 'npm install') {
      if (!sandboxData) {
        // More helpful message - user might be trying to run this too early
        addChatMessage('The sandbox is still being set up. Please wait for the generation to complete, then try again.', 'system');
        return;
      }
      await checkAndInstallPackages();
      return;
    }
    
    // Start sandbox creation in parallel if needed
    let sandboxPromise: Promise<void> | null = null;
    let sandboxCreating = false;
    
    if (!sandboxData) {
      sandboxCreating = true;
      addChatMessage('Creating sandbox while I plan your app...', 'system');
      sandboxPromise = createSandbox(true).catch((error: any) => {
        addChatMessage(`Failed to create sandbox: ${error.message}`, 'system');
        throw error;
      });
    }
    
    // Determine if this is an edit
    const isEdit = conversationContext.appliedCode.length > 0;
    
    try {
      // Generation tab is already active from scraping phase
      setGenerationProgress(prev => ({
        ...prev,  // Preserve all existing state
        isGenerating: true,
        status: 'Starting AI generation...',
        components: [],
        currentComponent: 0,
        streamedCode: '',
        isStreaming: false,
        isThinking: true,
        thinkingText: 'Analyzing your request...',
        thinkingDuration: undefined,
        currentFile: undefined,
        lastProcessedPosition: 0,
        // Add isEdit flag to generation progress
        isEdit: isEdit,
        // Keep existing files for edits - we'll mark edited ones differently
        files: prev.files
      }));
      
      // Backend now manages file state - no need to fetch from frontend
      console.log('[chat] Using backend file cache for context');
      
      const fullContext = {
        sandboxId: sandboxData?.sandboxId || (sandboxCreating ? 'pending' : null),
        structure: structureContent,
        recentMessages: chatMessages.slice(-20),
        conversationContext: conversationContext,
        currentCode: promptInput,
        sandboxUrl: sandboxData?.url,
        sandboxCreating: sandboxCreating
      };
      
      // Debug what we're sending
      console.log('[chat] Sending context to AI:');
      console.log('[chat] - sandboxId:', fullContext.sandboxId);
      console.log('[chat] - isEdit:', conversationContext.appliedCode.length > 0);
      
      const genProjectId = currentProjectIdRef.current || (await ensureProjectId());
      const response = await fetch('/api/generate-ai-code-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: apiPrompt,
          model: aiModel,
          context: fullContext,
          isEdit: conversationContext.appliedCode.length > 0,
          projectId: genProjectId || undefined
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let generatedCode = '';
      let explanation = '';
      let buffer = ''; // Buffer for incomplete lines
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          console.log('[chat] Received chunk:', chunk.length, 'bytes');
          buffer += chunk;
          const lines = buffer.split('\n');
          
          // Keep the last line in buffer if it's incomplete
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'status') {
                  setGenerationProgress(prev => ({ ...prev, status: data.message }));
                } else if (data.type === 'thinking') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: true,
                    thinkingText: (prev.thinkingText || '') + data.text
                  }));
                } else if (data.type === 'thinking_complete') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: false,
                    thinkingDuration: data.duration
                  }));
                } else if (data.type === 'conversation') {
                  // Add conversational text to chat only if it's not code
                  let text = data.text || '';
                  
                  // Remove package tags from the text
                  text = text.replace(/<package>[^<]*<\/package>/g, '');
                  text = text.replace(/<packages>[^<]*<\/packages>/g, '');
                  
                  // Filter out any XML tags and file content that slipped through
                  if (!text.includes('<file') && !text.includes('import React') && 
                      !text.includes('export default') && !text.includes('className=') &&
                      text.trim().length > 0) {
                    addChatMessage(text.trim(), 'ai');
                  }
                } else if (data.type === 'stream' && data.raw) {
                  setGenerationProgress(prev => {
                    const newStreamedCode = prev.streamedCode + data.text;
                    
                    // Tab is already switched after scraping
                    
                    const updatedState = { 
                      ...prev, 
                      streamedCode: newStreamedCode,
                      isStreaming: true,
                      isThinking: false,
                      status: 'Generating code...'
                    };
                    
                    // Process complete files from the accumulated stream
                    const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
                    let match;
                    const processedFiles = new Set(prev.files.map(f => f.path));
                    
                    while ((match = fileRegex.exec(newStreamedCode)) !== null) {
                      const filePath = match[1];
                      const fileContent = match[2];
                      
                      // Only add if we haven't processed this file yet
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        // Check if file already exists
                        const existingFileIndex = updatedState.files.findIndex(f => f.path === filePath);
                        
                        if (existingFileIndex >= 0) {
                          // Update existing file and mark as edited
                          updatedState.files = [
                            ...updatedState.files.slice(0, existingFileIndex),
                            {
                              ...updatedState.files[existingFileIndex],
                              content: fileContent.trim(),
                              type: fileType,
                              completed: true,
                              edited: true
                            },
                            ...updatedState.files.slice(existingFileIndex + 1)
                          ];
                        } else {
                          // Add new file
                          updatedState.files = [...updatedState.files, {
                            path: filePath,
                            content: fileContent.trim(),
                            type: fileType,
                            completed: true,
                            edited: false
                          }];
                        }
                        
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Completed ${filePath}`;
                        }
                        processedFiles.add(filePath);
                      }
                    }
                    
                    // Check for current file being generated (incomplete file at the end)
                    const lastFileMatch = newStreamedCode.match(/<file path="([^"]+)">([^]*?)$/);
                    if (lastFileMatch && !lastFileMatch[0].includes('</file>')) {
                      const filePath = lastFileMatch[1];
                      const partialContent = lastFileMatch[2];
                      
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        updatedState.currentFile = { 
                          path: filePath, 
                          content: partialContent, 
                          type: fileType 
                        };
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Generating ${filePath}`;
                        }
                      }
                    } else {
                      updatedState.currentFile = undefined;
                    }
                    
                    return updatedState;
                  });
                } else if (data.type === 'app') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    status: 'Generated App.jsx structure'
                  }));
                } else if (data.type === 'component') {
                  setGenerationProgress(prev => ({
                    ...prev,
                    status: `Generated ${data.name}`,
                    components: [...prev.components, { 
                      name: data.name, 
                      path: data.path, 
                      completed: true 
                    }],
                    currentComponent: data.index
                  }));
                } else if (data.type === 'package') {
                  // Handle package installation from tool calls
                  setGenerationProgress(prev => ({
                    ...prev,
                    status: data.message || `Installing ${data.name}`
                  }));
                } else if (data.type === 'complete') {
                  generatedCode = data.generatedCode;
                  explanation = data.explanation;
                  
                  // Save the last generated code
                  setConversationContext(prev => ({
                    ...prev,
                    lastGeneratedCode: generatedCode
                  }));
                  
                  // Clear thinking state when generation completes
                  setGenerationProgress(prev => ({
                    ...prev,
                    isThinking: false,
                    thinkingText: undefined,
                    thinkingDuration: undefined
                  }));
                  
                  // Store packages to install from tool calls
                  if (data.packagesToInstall && data.packagesToInstall.length > 0) {
                    console.log('[generate-code] Packages to install from tools:', data.packagesToInstall);
                    // Store packages globally for later installation
                    (window as any).pendingPackages = data.packagesToInstall;
                  }
                  
                  // Parse all files from the completed code if not already done
                  const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
                  const parsedFiles: Array<{path: string; content: string; type: string; completed: boolean}> = [];
                  let fileMatch;
                  
                  while ((fileMatch = fileRegex.exec(data.generatedCode)) !== null) {
                    const filePath = fileMatch[1];
                    const fileContent = fileMatch[2];
                    const fileExt = filePath.split('.').pop() || '';
                    const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                    fileExt === 'css' ? 'css' :
                                    fileExt === 'json' ? 'json' :
                                    fileExt === 'html' ? 'html' : 'text';
                    
                    parsedFiles.push({
                      path: filePath,
                      content: fileContent.trim(),
                      type: fileType,
                      completed: true
                    });
                  }
                  
                  setGenerationProgress(prev => ({
                    ...prev,
                    status: `Generated ${parsedFiles.length > 0 ? parsedFiles.length : prev.files.length} file${(parsedFiles.length > 0 ? parsedFiles.length : prev.files.length) !== 1 ? 's' : ''}!`,
                    isGenerating: false,
                    isStreaming: false,
                    isEdit: prev.isEdit,
                    // Keep the files that were already parsed during streaming
                    files: prev.files.length > 0 ? prev.files : parsedFiles
                  }));
                } else if (data.type === 'error') {
                  throw new Error(data.error);
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
            }
          }
        }
      }
      
      if (generatedCode) {
        // Parse files from generated code for metadata
        const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
        const generatedFiles = [];
        let match;
        while ((match = fileRegex.exec(generatedCode)) !== null) {
          generatedFiles.push(match[1]);
        }
        
        // Record the build as a permanent step in the conversation so the list of
        // files stays visible after the build finishes and survives a page reload.
        if (generatedFiles.length > 0) {
          addChatMessage('', 'build', { appliedFiles: generatedFiles });
        }

        // Show appropriate message based on edit mode
        if (isEdit && generatedFiles.length > 0) {
          // For edits, show which file(s) were edited
          const editedFileNames = generatedFiles.map(f => f.split('/').pop()).join(', ');
          addChatMessage(
            explanation || `Updated ${editedFileNames}`,
            'ai',
            {
              appliedFiles: [generatedFiles[0]] // Only show the first edited file
            }
          );
        } else {
          // For new generation, show all files
          addChatMessage(explanation || 'Code generated!', 'ai', {
            appliedFiles: generatedFiles
          });
        }
        
        setPromptInput(generatedCode);
        // Don't show the Generated Code panel by default
        // setLeftPanelVisible(true);
        
        // Wait for sandbox creation if it's still in progress
        let activeSandboxData = sandboxData;
        if (sandboxPromise) {
          addChatMessage('Waiting for sandbox to be ready...', 'system');
          try {
            const newSandboxData = await sandboxPromise;
            if (newSandboxData != null) {
              activeSandboxData = newSandboxData;
              // Also update the state for future use
              setSandboxData(newSandboxData);
            }
            // Remove the waiting message
            setChatMessages(prev => prev.filter(msg => msg.content !== 'Waiting for sandbox to be ready...'));
          } catch {
            addChatMessage('Sandbox creation failed. Cannot apply code.', 'system');
            return;
          }
        }

        // Fallback: our own createSandbox() may have returned null because another
        // creation (e.g. the auto-create on page load) was already in progress. In that
        // case the real sandbox lives in the ref/state — use it so we still apply the code.
        if (!activeSandboxData) {
          // Give an in-flight creation a moment to settle, then read the latest value.
          for (let i = 0; i < 30 && !sandboxDataRef.current; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          activeSandboxData = sandboxDataRef.current;
          if (activeSandboxData) {
            setChatMessages(prev => prev.filter(msg => msg.content !== 'Waiting for sandbox to be ready...'));
          }
        }

        if (!activeSandboxData) {
          addChatMessage('Sandbox was not ready in time, so the generated code was not applied. Please send your request again.', 'system');
        }

        if (activeSandboxData && generatedCode) {
          // For new sandbox creations (especially Vercel), add a delay to ensure Vite is ready
          if (sandboxCreating) {
            console.log('[startGeneration] New sandbox created, waiting for services to be ready...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          // Automatically decide if this app needs to save data. If so, set up
          // storage (once) and create any tables the response declared — all
          // before applying the code, so the app works on first load.
          let db = dbInfo;
          if (responseNeedsDatabase(generatedCode)) {
            if (!db) db = await ensureDatabase();
            await createTablesFromResponse(generatedCode, db);
          }

          // Likewise decide if the app uses the built-in AI; if so provision the
          // per-project token + inject it into the sandbox before applying code.
          if (responseNeedsAi(generatedCode)) {
            await ensureAi();
          }

          // Use isEdit flag that was determined at the start
          // Pass the sandbox data from the promise if it's different from the state
          await applyGeneratedCode(generatedCode, isEdit, activeSandboxData !== sandboxData ? activeSandboxData : undefined);
        }
      }
      
      // Show completion status briefly then switch to preview
      setGenerationProgress(prev => ({
        ...prev,
        isGenerating: false,
        isStreaming: false,
        status: 'Generation complete!',
        isEdit: prev.isEdit,
        // Clear thinking state on completion
        isThinking: false,
        thinkingText: undefined,
        thinkingDuration: undefined
      }));
      
      setTimeout(() => {
        // Switch to preview but keep files for display
        setActiveTab('preview');
      }, 1000); // Reduced from 3000ms to 1000ms
    } catch (error: any) {
      setChatMessages(prev => prev.filter(msg => msg.content !== 'Thinking...'));
      addChatMessage(`Error: ${error.message}`, 'system');
      // Reset generation progress and switch back to preview on error
      setGenerationProgress({
        isGenerating: false,
        status: '',
        components: [],
        currentComponent: 0,
        streamedCode: '',
        isStreaming: false,
        isThinking: false,
        thinkingText: undefined,
        thinkingDuration: undefined,
        files: [],
        currentFile: undefined,
        lastProcessedPosition: 0
      });
      setActiveTab('preview');
    }
  };


  const downloadZip = async () => {
    if (!sandboxData) {
      addChatMessage('Please wait for the sandbox to be created before downloading.', 'system');
      return;
    }
    
    setLoading(true);
    log('Creating zip file...');
    addChatMessage('Creating ZIP file of your Vite app...', 'system');
    
    try {
      const response = await fetch('/api/create-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProjectIdRef.current || undefined })
      });
      
      const data = await response.json();
      
      if (data.success) {
        log('Zip file created!');
        addChatMessage('ZIP file created! Download starting...', 'system');
        
        const link = document.createElement('a');
        link.href = data.dataUrl;
        link.download = data.fileName || 'e2b-project.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        addChatMessage(
          'Your Vite app has been downloaded! To run it locally:\n' +
          '1. Unzip the file\n' +
          '2. Run: npm install\n' +
          '3. Run: npm run dev\n' +
          '4. Open http://localhost:5173',
          'system'
        );
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      log(`Failed to create zip: ${error.message}`, 'error');
      addChatMessage(`Failed to create ZIP: ${error.message}`, 'system');
    } finally {
      setLoading(false);
    }
  };

  const deployProject = async () => {
    if (!sandboxData) {
      addChatMessage('Please wait for the sandbox to be created before publishing.', 'system');
      return;
    }

    setLoading(true);
    log('Publishing app...');
    setDeployStatus({ stage: 'publishing' });

    try {
      // Persist a project first so the deploy target is remembered on the project
      // row (stable URL across deploys/restarts). The server auto-detects whether
      // the app is static or full-stack and publishes it to the right place.
      const projectId = await ensureProjectId();
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId })
      });

      const data = await response.json();

      if (data.success) {
        log(`Published: ${data.url}`);
        setDeployStatus({
          stage: 'published',
          url: data.url,
          processing: !!(data.state && data.state !== 'ready' && data.state !== 'READY'),
        });
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      log(`Failed to publish: ${error.message}`, 'error');
      setDeployStatus({ stage: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  };

  const reapplyLastGeneration = async () => {
    if (!conversationContext.lastGeneratedCode) {
      addChatMessage('No previous generation to re-apply', 'system');
      return;
    }
    
    if (!sandboxData) {
      addChatMessage('Please create a sandbox first', 'system');
      return;
    }
    
    addChatMessage('Re-applying last generation...', 'system');
    const isEdit = conversationContext.appliedCode.length > 0;
    await applyGeneratedCode(conversationContext.lastGeneratedCode, isEdit);
  };

  // Auto-scroll code display to bottom when streaming
  useEffect(() => {
    if (codeDisplayRef.current && generationProgress.isStreaming) {
      codeDisplayRef.current.scrollTop = codeDisplayRef.current.scrollHeight;
    }
  }, [generationProgress.streamedCode, generationProgress.isStreaming]);

  const toggleFolder = (folderPath: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderPath)) {
      newExpanded.delete(folderPath);
    } else {
      newExpanded.add(folderPath);
    }
    setExpandedFolders(newExpanded);
  };

  const handleFileClick = async (filePath: string) => {
    setSelectedFile(filePath);
    // TODO: Add file content fetching logic here
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    
    if (ext === 'jsx' || ext === 'js') {
      return <SiJavascript style={{ width: '16px', height: '16px' }} className="text-yellow-500" />;
    } else if (ext === 'tsx' || ext === 'ts') {
      return <SiReact style={{ width: '16px', height: '16px' }} className="text-blue-500" />;
    } else if (ext === 'css') {
      return <SiCss3 style={{ width: '16px', height: '16px' }} className="text-blue-500" />;
    } else if (ext === 'json') {
      return <SiJson style={{ width: '16px', height: '16px' }} className="text-[#9a9aa5]" />;
    } else {
      return <FiFile style={{ width: '16px', height: '16px' }} className="text-[#9a9aa5]" />;
    }
  };

//   const clearChatHistory = () => {
//     setChatMessages([{
//       content: 'Chat history cleared. How can I help you?',
//       type: 'system',
//       timestamp: new Date()
//     }]);
//   };
// 

//   const cloneWebsite = async () => {
//     let url = urlInput.trim();
//     if (!url) {
//       setUrlStatus(prev => [...prev, 'Please enter a URL']);
//       return;
//     }
//     
//     if (!url.match(/^https?:\/\//i)) {
//       url = 'https://' + url;
//     }
//     
//     setUrlStatus([`Using: ${url}`, 'Starting to scrape...']);
//     
//     setUrlOverlayVisible(false);
//     
//     // Remove protocol for cleaner display
//     const cleanUrl = url.replace(/^https?:\/\//i, '');
//     addChatMessage(`Starting to clone ${cleanUrl}...`, 'system');
//     
//     // Capture screenshot immediately and switch to preview tab
//     captureUrlScreenshot(url);
//     
//     try {
//       addChatMessage('Scraping website content...', 'system');
//       const scrapeResponse = await fetch('/api/scrape-url-enhanced', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ url })
//       });
//       
//       if (!scrapeResponse.ok) {
//         throw new Error(`Scraping failed: ${scrapeResponse.status}`);
//       }
//       
//       const scrapeData = await scrapeResponse.json();
//       
//       if (!scrapeData.success) {
//         throw new Error(scrapeData.error || 'Failed to scrape website');
//       }
//       
//       addChatMessage(`Scraped ${scrapeData.content.length} characters from ${url}`, 'system');
//       
//       // Clear preparing design state and switch to generation tab
//       setIsPreparingDesign(false);
//       setActiveTab('generation');
//       
//       setConversationContext(prev => ({
//         ...prev,
//         scrapedWebsites: [...prev.scrapedWebsites, {
//           url,
//           content: scrapeData,
//           timestamp: new Date()
//         }],
//         currentProject: `Clone of ${url}`
//       }));
//       
//       // Start sandbox creation in parallel with code generation
//       let sandboxPromise: Promise<any> | null = null;
//       if (!sandboxData) {
//         addChatMessage('Creating sandbox while generating your React app...', 'system');
//         sandboxPromise = createSandbox(true);
//       }
//       
//       addChatMessage('Analyzing and generating React recreation...', 'system');
//       
//       const recreatePrompt = `I scraped this website and want you to recreate it as a modern React application.
// 
// URL: ${url}
// 
// SCRAPED CONTENT:
// ${scrapeData.content}
// 
// ${homeContextInput ? `ADDITIONAL CONTEXT/REQUIREMENTS FROM USER:
// ${homeContextInput}
// 
// Please incorporate these requirements into the design and implementation.` : ''}
// 
// REQUIREMENTS:
// 1. Create a COMPLETE React application with App.jsx as the main component
// 2. App.jsx MUST import and render all other components
// 3. Recreate the main sections and layout from the scraped content
// 4. ${homeContextInput ? `Apply the user's context/theme: "${homeContextInput}"` : `Use a modern dark theme with excellent contrast:
//    - Background: #0a0a0a
//    - Text: #ffffff
//    - Links: #60a5fa
//    - Accent: #3b82f6`}
// 5. Make it fully responsive
// 6. Include hover effects and smooth transitions
// 7. Create separate components for major sections (Header, Hero, Features, etc.)
// 8. Use semantic HTML5 elements
// 
// IMPORTANT CONSTRAINTS:
// - DO NOT use React Router or any routing libraries
// - Use regular <a> tags with href="#section" for navigation, NOT Link or NavLink components
// - This is a single-page application, no routing needed
// - ALWAYS create src/App.jsx that imports ALL components
// - Each component should be in src/components/
// - Use Tailwind CSS for ALL styling (no custom CSS files)
// - Make sure the app actually renders visible content
// - Create ALL components that you reference in imports
// 
// IMAGE HANDLING RULES:
// - When the scraped content includes images, USE THE ORIGINAL IMAGE URLS whenever appropriate
// - Keep existing images from the scraped site (logos, product images, hero images, icons, etc.)
// - Use the actual image URLs provided in the scraped content, not placeholders
// - Only use placeholder images or generic services when no real images are available
// - For company logos and brand images, ALWAYS use the original URLs to maintain brand identity
// - If scraped data contains image URLs, include them in your img tags
// - Example: If you see "https://example.com/logo.png" in the scraped content, use that exact URL
// 
// Focus on the key sections and content, making it clean and modern while preserving visual assets.`;
//       
//       setGenerationProgress(prev => ({
//         isGenerating: true,
//         status: 'Initializing AI...',
//         components: [],
//         currentComponent: 0,
//         streamedCode: '',
//         isStreaming: true,
//         isThinking: false,
//         thinkingText: undefined,
//         thinkingDuration: undefined,
//         // Keep previous files until new ones are generated
//         files: prev.files || [],
//         currentFile: undefined,
//         lastProcessedPosition: 0
//       }));
//       
//       // Switch to generation tab when starting
//       setActiveTab('generation');
//       
//       const aiResponse = await fetch('/api/generate-ai-code-stream', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           prompt: recreatePrompt,
//           model: aiModel,
//           context: {
//             sandboxId: sandboxData?.id,
//             structure: structureContent,
//             conversationContext: conversationContext
//           }
//         })
//       });
//       
//       if (!aiResponse.ok) {
//         throw new Error(`AI generation failed: ${aiResponse.status}`);
//       }
//       
//       const reader = aiResponse.body?.getReader();
//       const decoder = new TextDecoder();
//       let generatedCode = '';
//       let explanation = '';
//       
//       if (reader) {
//         while (true) {
//           const { done, value } = await reader.read();
//           if (done) break;
//           
//           const chunk = decoder.decode(value);
//           const lines = chunk.split('\n');
//           
//           for (const line of lines) {
//             if (line.startsWith('data: ')) {
//               try {
//                 const data = JSON.parse(line.slice(6));
//                 
//                 if (data.type === 'status') {
//                   setGenerationProgress(prev => ({ ...prev, status: data.message }));
//                 } else if (data.type === 'thinking') {
//                   setGenerationProgress(prev => ({ 
//                     ...prev, 
//                     isThinking: true,
//                     thinkingText: (prev.thinkingText || '') + data.text
//                   }));
//                 } else if (data.type === 'thinking_complete') {
//                   setGenerationProgress(prev => ({ 
//                     ...prev, 
//                     isThinking: false,
//                     thinkingDuration: data.duration
//                   }));
//                 } else if (data.type === 'conversation') {
//                   // Add conversational text to chat only if it's not code
//                   let text = data.text || '';
//                   
//                   // Remove package tags from the text
//                   text = text.replace(/<package>[^<]*<\/package>/g, '');
//                   text = text.replace(/<packages>[^<]*<\/packages>/g, '');
//                   
//                   // Filter out any XML tags and file content that slipped through
//                   if (!text.includes('<file') && !text.includes('import React') && 
//                       !text.includes('export default') && !text.includes('className=') &&
//                       text.trim().length > 0) {
//                     addChatMessage(text.trim(), 'ai');
//                   }
//                 } else if (data.type === 'stream' && data.raw) {
//                   setGenerationProgress(prev => ({ 
//                     ...prev, 
//                     streamedCode: prev.streamedCode + data.text,
//                     lastProcessedPosition: prev.lastProcessedPosition || 0
//                   }));
//                 } else if (data.type === 'component') {
//                   setGenerationProgress(prev => ({
//                     ...prev,
//                     status: `Generated ${data.name}`,
//                     components: [...prev.components, { 
//                       name: data.name,
//                       path: data.path,
//                       completed: true
//                     }],
//                     currentComponent: prev.currentComponent + 1
//                   }));
//                 } else if (data.type === 'complete') {
//                   generatedCode = data.generatedCode;
//                   explanation = data.explanation;
//                   
//                   // Save the last generated code
//                   setConversationContext(prev => ({
//                     ...prev,
//                     lastGeneratedCode: generatedCode
//                   }));
//                 }
//               } catch (e) {
//                 console.error('Error parsing streaming data:', e);
//               }
//             }
//           }
//         }
//       }
//       
//       setGenerationProgress(prev => ({
//         ...prev,
//         isGenerating: false,
//         isStreaming: false,
//         status: 'Generation complete!',
//         isEdit: prev.isEdit
//       }));
//       
//       if (generatedCode) {
//         addChatMessage('AI recreation generated!', 'system');
//         
//         // Add the explanation to chat if available
//         if (explanation && explanation.trim()) {
//           addChatMessage(explanation, 'ai');
//         }
//         
//         setPromptInput(generatedCode);
//         // Don't show the Generated Code panel by default
//         // setLeftPanelVisible(true);
//         
//         // Wait for sandbox creation if it's still in progress
//         let activeSandboxData = sandboxData;
//         if (sandboxPromise) {
//           addChatMessage('Waiting for sandbox to be ready...', 'system');
//           try {
//             const newSandboxData = await sandboxPromise;
//             if (newSandboxData) {
//               activeSandboxData = newSandboxData;
//             }
//             // Remove the waiting message
//             setChatMessages(prev => prev.filter(msg => msg.content !== 'Waiting for sandbox to be ready...'));
//           } catch (error: any) {
//             addChatMessage('Sandbox creation failed. Cannot apply code.', 'system');
//             throw error;
//           }
//         }
//         
//         // Only apply code if we have sandbox data
//         if (activeSandboxData) {
//           // First application for cloned site should not be in edit mode
//           await applyGeneratedCode(generatedCode, false);
//         }
//         
//         addChatMessage(
//           `Successfully recreated ${url} as a modern React app${homeContextInput ? ` with your requested context: "${homeContextInput}"` : ''}! The scraped content is now in my context, so you can ask me to modify specific sections or add features based on the original site.`, 
//           'ai',
//           {
//             scrapedUrl: url,
//             scrapedContent: scrapeData,
//             generatedCode: generatedCode
//           }
//         );
//         
//         setUrlInput('');
//         setUrlStatus([]);
//         setHomeContextInput('');
//         
//         // Clear generation progress and all screenshot/design states
//         setGenerationProgress(prev => ({
//           ...prev,
//           isGenerating: false,
//           isStreaming: false,
//           status: 'Generation complete!'
//         }));
//         
//         // Clear screenshot and preparing design states to prevent them from showing on next run
//         setUrlScreenshot(null);
//         setIsPreparingDesign(false);
//         setTargetUrl('');
//         setScreenshotError(null);
//         setLoadingStage(null); // Clear loading stage
//         setShowLoadingBackground(false); // Clear loading background
//         
//         setTimeout(() => {
//           // Switch back to preview tab but keep files
//           setActiveTab('preview');
//         }, 1000); // Show completion briefly then switch
//       } else {
//         throw new Error('Failed to generate recreation');
//       }
//       
//     } catch (error: any) {
//       addChatMessage(`Failed to clone website: ${error.message}`, 'system');
//       setUrlStatus([]);
//       setIsPreparingDesign(false);
//       // Clear all states on error
//       setUrlScreenshot(null);
//       setTargetUrl('');
//       setScreenshotError(null);
//       setLoadingStage(null);
//       setGenerationProgress(prev => ({
//         ...prev,
//         isGenerating: false,
//         isStreaming: false,
//         status: '',
//         // Keep files to display in sidebar
//         files: prev.files
//       }));
//       setActiveTab('preview');
//     }
//   };

  const captureUrlScreenshot = async (url: string) => {
    setIsCapturingScreenshot(true);
    setScreenshotError(null);
    try {
      const response = await fetch('/api/scrape-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      const data = await response.json();
      if (data.success && data.screenshot) {
        setIsScreenshotLoaded(false); // Reset loaded state for new screenshot
        setUrlScreenshot(data.screenshot);
        // Set preparing design state
        setIsPreparingDesign(true);
        // Store the clean URL for display
        const cleanUrl = url.replace(/^https?:\/\//i, '');
        setTargetUrl(cleanUrl);
        // Switch to preview tab to show the screenshot
        if (activeTab !== 'preview') {
          setActiveTab('preview');
        }
      } else {
        setScreenshotError(data.error || 'Failed to capture screenshot');
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      setScreenshotError('Network error while capturing screenshot');
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  const handleHomeScreenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startGeneration();
  };

  const startGeneration = async () => {
    if (!homeUrlInput.trim()) return;
    
    setHomeScreenFading(true);
    
    // Set immediate loading state for better UX
    setIsStartingNewGeneration(true);
    setLoadingStage('gathering');
    
    // Immediately switch to preview tab to show loading
    setActiveTab('preview');
    
    // Set loading background to ensure proper visual feedback
    setShowLoadingBackground(true);
    
    // Clear messages and immediately show the initial message
    setChatMessages([]);
    let displayUrl = homeUrlInput.trim();
    if (!displayUrl.match(/^https?:\/\//i)) {
      displayUrl = 'https://' + displayUrl;
    }
    // Remove protocol for cleaner display
    const cleanUrl = displayUrl.replace(/^https?:\/\//i, '');

    // Check if we're in brand extension mode
    const brandExtensionMode = sessionStorage.getItem('brandExtensionMode') === 'true';

    addChatMessage(
      brandExtensionMode
        ? `Analyzing brand from ${cleanUrl}...`
        : `Starting to clone ${cleanUrl}...`,
      'system'
    );
    
    // Start creating sandbox and capturing screenshot immediately in parallel
    const sandboxPromise = !sandboxData ? createSandbox(true) : Promise.resolve(null);
    
    // Set loading stage immediately before hiding home screen
    setLoadingStage('gathering');
    // Also ensure we're on preview tab to show the loading overlay
    setActiveTab('preview');
    
    // Always capture screenshot for new URLs, even if sandbox exists
    // This ensures the loading screen shows properly
    captureUrlScreenshot(displayUrl);
    
    setTimeout(async () => {
      setShowHomeScreen(false);
      setHomeScreenFading(false);
      
      // Clear the starting flag after transition
      setTimeout(() => {
        setIsStartingNewGeneration(false);
      }, 1000);
      
      // Wait for sandbox to be ready (if it's still creating)
      const createdSandbox = await sandboxPromise;
      
      // Now start the clone process which will stream the generation
      setUrlInput(homeUrlInput);
      setUrlOverlayVisible(false); // Make sure overlay is closed
      setUrlStatus(['Scraping website content...']);
      
      try {
        // Scrape the website
        let url = homeUrlInput.trim();
        if (!url.match(/^https?:\/\//i)) {
          url = 'https://' + url;
        }

        // Check if we're in brand extension mode
        const brandExtensionMode = sessionStorage.getItem('brandExtensionMode') === 'true';
        const brandExtensionPrompt = sessionStorage.getItem('brandExtensionPrompt') || '';

        // Screenshot is already being captured in parallel above

        let scrapeData: ScrapeData | undefined;
        let brandGuidelines: any;

        if (brandExtensionMode) {
          // === BRAND EXTENSION MODE ===
          addChatMessage('Extracting brand styles from the website...', 'system');

          // Call the brand extraction endpoint
          const extractResponse = await fetch('/api/extract-brand-styles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url,
              prompt: brandExtensionPrompt
            })
          });

          if (!extractResponse.ok) {
            throw new Error('Failed to extract brand styles');
          }

          brandGuidelines = await extractResponse.json();

          if (!brandGuidelines.success) {
            throw new Error(brandGuidelines.error || 'Failed to extract brand styles');
          }

          // Display branding summary with visual UI
          addChatMessage(`Acquired branding format from ${cleanUrl}`, 'system', {
            brandingData: brandGuidelines.guidelines,
            sourceUrl: cleanUrl
          });
          addChatMessage(`Building your custom component using these brand guidelines...`, 'system');

          // Clear the flags after use
          sessionStorage.removeItem('brandExtensionMode');
          sessionStorage.removeItem('brandExtensionPrompt');

        } else {
          // === NORMAL CLONE MODE ===
          // Check if we have pre-scraped markdown content from search results
          const storedMarkdown = sessionStorage.getItem('siteMarkdown');
        if (storedMarkdown) {
          // Use the pre-scraped content
          scrapeData = {
            success: true,
            content: storedMarkdown,
            title: new URL(url).hostname,
            source: 'search-result'
          };
          sessionStorage.removeItem('siteMarkdown'); // Clear after use
          addChatMessage('Using cached content from search results...', 'system');
        } else {
          // Perform fresh scraping
          const scrapeResponse = await fetch('/api/scrape-url-enhanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          
          if (!scrapeResponse.ok) {
            throw new Error('Failed to scrape website');
          }
          
          scrapeData = await scrapeResponse.json() as ScrapeData;
          
          if (!scrapeData.success) {
            throw new Error(scrapeData.error || 'Failed to scrape website');
          }
        }
        }

        setUrlStatus(brandExtensionMode ? ['Brand styles extracted!', 'Building your component...'] : ['Website scraped successfully!', 'Generating React app...']);

        // Clear preparing design state and switch to generation tab
        setIsPreparingDesign(false);
        setIsScreenshotLoaded(false); // Reset loaded state
        setUrlScreenshot(null); // Clear screenshot when starting generation
        setTargetUrl(''); // Clear target URL

        // Update loading stage to planning
        setLoadingStage('planning');

        // Brief pause before switching to generation tab
        setTimeout(() => {
          setLoadingStage('generating');
          setActiveTab('generation');
        }, 1500);

        // Build the appropriate prompt based on mode
        let prompt;

        if (brandExtensionMode && brandGuidelines) {
          // === BRAND EXTENSION PROMPT ===
          // Store brand guidelines in conversation context
          setConversationContext(prev => ({
            ...prev,
            scrapedWebsites: [...prev.scrapedWebsites, {
              url: url,
              content: { brandGuidelines },
              timestamp: new Date()
            }],
            currentProject: `Custom build using ${url} brand`
          }));

          // Extract comprehensive brand data
          const branding = brandGuidelines.guidelines;

          // Build detailed brand instruction string
          const brandInstructions = `
BRAND GUIDELINES FROM ${url}:

COLOR SYSTEM:
- Color Scheme: ${branding.colorScheme || 'light'} mode
- Primary Color: ${branding.colors?.primary || 'not specified'}
- Accent Color: ${branding.colors?.accent || 'not specified'}
- Background: ${branding.colors?.background || 'not specified'}
- Text Primary: ${branding.colors?.textPrimary || 'not specified'}
- Link Color: ${branding.colors?.link || 'not specified'}

TYPOGRAPHY:
- Primary Font: ${branding.typography?.fontFamilies?.primary || 'system default'}
- Heading Font: ${branding.typography?.fontFamilies?.heading || 'system default'}
- Font Stack (Body): ${branding.typography?.fontStacks?.body?.join(', ') || 'system-ui, sans-serif'}
- Font Stack (Heading): ${branding.typography?.fontStacks?.heading?.join(', ') || 'system-ui, sans-serif'}
- H1 Size: ${branding.typography?.fontSizes?.h1 || '36px'}
- H2 Size: ${branding.typography?.fontSizes?.h2 || '30px'}
- Body Size: ${branding.typography?.fontSizes?.body || '16px'}

SPACING & LAYOUT:
- Base Spacing Unit: ${branding.spacing?.baseUnit || '4'}px
- Border Radius: ${branding.spacing?.borderRadius || '6px'}

BUTTON STYLES:
Primary Button:
  - Background: ${branding.components?.buttonPrimary?.background || branding.colors?.primary}
  - Text Color: ${branding.components?.buttonPrimary?.textColor || '#FFFFFF'}
  - Border Radius: ${branding.components?.buttonPrimary?.borderRadius || branding.spacing?.borderRadius || '8px'}
  - Shadow: ${branding.components?.buttonPrimary?.shadow || 'none'}

Secondary Button:
  - Background: ${branding.components?.buttonSecondary?.background || '#F9F9F9'}
  - Text Color: ${branding.components?.buttonSecondary?.textColor || branding.colors?.textPrimary}
  - Border Radius: ${branding.components?.buttonSecondary?.borderRadius || branding.spacing?.borderRadius || '8px'}
  - Shadow: ${branding.components?.buttonSecondary?.shadow || 'none'}

INPUT FIELDS:
- Border Color: ${branding.components?.input?.borderColor || '#CCCCCC'}
- Border Radius: ${branding.components?.input?.borderRadius || branding.spacing?.borderRadius || '6px'}

BRAND PERSONALITY:
- Tone: ${branding.personality?.tone || 'professional'}
- Energy: ${branding.personality?.energy || 'medium'}
- Target Audience: ${branding.personality?.targetAudience || 'general'}

DESIGN SYSTEM:
- Framework: ${branding.designSystem?.framework || 'tailwind'}
- Component Library: ${branding.designSystem?.componentLibrary || 'custom'}

ASSETS:
${branding.images?.logo ? `- Logo Available: Yes (use carefully if needed)` : '- Logo: Not available'}
${branding.images?.favicon ? `- Favicon: ${branding.images.favicon}` : ''}`;

          prompt = `I want you to build a NEW React component/application based on these brand guidelines and the user's requirements.

<branding-format source="${url}">
${brandInstructions}

RAW BRAND DATA (for reference):
${JSON.stringify(branding, null, 2)}
</branding-format>

USER'S REQUEST:
${brandExtensionPrompt || 'Build a modern web component using these brand guidelines'}

IMPORTANT: The content above in the <branding-format> tags contains the extracted brand guidelines from ${url}.
Use these guidelines (colors, fonts, spacing, design patterns) to build what the user requested.

CRITICAL REQUIREMENTS:
- DO NOT recreate the original website at ${url}
- DO create a COMPLETELY NEW component that fulfills the user's request
- The user wants: "${brandExtensionPrompt}"
- Build ONLY what the user requested - nothing more
- App.jsx should render ONLY the requested component - no extra Header/Footer/Hero unless specifically requested
- Make it a minimal, focused implementation of the user's request

STYLING REQUIREMENTS:
- Apply the EXACT colors from the brand palette (primary, accent, background, text colors)
- Use the EXACT typography (font families, font sizes for h1, h2, body)
- Apply the spacing system (base unit: ${branding.spacing?.baseUnit || '4'}px)
- Use the specified border radius (${branding.spacing?.borderRadius || '6px'}) consistently
- Implement button styles EXACTLY as specified (colors, shadows, border radius)
- Style input fields with the exact border color and border radius
- Match the brand's ${branding.colorScheme || 'light'} color scheme
- Apply the brand personality: ${branding.personality?.tone || 'professional'} tone with ${branding.personality?.energy || 'medium'} energy
- Use Tailwind CSS with inline color values matching the brand palette EXACTLY
- If fonts need to be imported, add @import or @font-face rules to index.css
- Create custom CSS classes in index.css for complex shadows/effects that can't be done with Tailwind

FONT SETUP:
${branding.typography?.fontFamilies?.primary ? `
- Add font family "${branding.typography.fontFamilies.primary}" to your CSS
- Use font stack: ${branding.typography?.fontStacks?.body?.join(', ') || 'system-ui, sans-serif'}
- Set body font size to ${branding.typography?.fontSizes?.body || '16px'}` : '- Use system fonts'}

COMPONENT STRUCTURE:
- src/index.css - Include brand fonts, custom shadows/effects, and base styling
- src/App.jsx - Should ONLY render the requested component (e.g., just <PricingPage /> if user wants pricing)
- src/components/[RequestedComponent].jsx - The actual component fulfilling the user's request

TECHNICAL REQUIREMENTS:
- Create a WORKING, self-contained application
- DO NOT import components that don't exist
- Make sure the app renders immediately with visible content
- All colors must match the brand palette EXACTLY
- All spacing must use the ${branding.spacing?.baseUnit || '4'}px base unit
- Buttons must have the exact styling specified in the guidelines

Focus on building something NEW, minimal, and functional that perfectly matches the ${brandGuidelines.styleName || 'brand'} aesthetic and design system.`;

        } else {
          // === NORMAL CLONE MODE PROMPT ===
          // Store scraped data in conversation context
          if (!scrapeData) {
            throw new Error('Scrape data is missing');
          }
          setConversationContext(prev => ({
            ...prev,
            scrapedWebsites: [...prev.scrapedWebsites, {
              url: url,
              content: scrapeData,
              timestamp: new Date()
            }],
            currentProject: `${url} Clone`
          }));

          // Filter out style-related context when using screenshot/URL-based generation
          // Only keep user's explicit instructions, not inherited styles
          let filteredContext = homeContextInput;
          if (homeUrlInput && homeContextInput) {
            // Check if the context contains default style names that shouldn't be inherited
            const stylePatterns = [
              'Glassmorphism style design',
              'Neumorphism style design',
              'Brutalism style design',
              'Minimalist style design',
              'Dark Mode style design',
              'Gradient Rich style design',
              '3D Depth style design',
              'Retro Wave style design',
              'Modern clean and minimalist style design',
              'Fun colorful and playful style design',
              'Corporate professional and sleek style design',
              'Creative artistic and unique style design'
            ];

            // If the context exactly matches or starts with a style pattern, filter it out
            const startsWithStyle = stylePatterns.some(pattern =>
              homeContextInput.trim().startsWith(pattern)
            );

            if (startsWithStyle) {
              // Extract only the additional instructions part after the style
              const additionalMatch = homeContextInput.match(/\. (.+)$/);
              filteredContext = additionalMatch ? additionalMatch[1] : '';
            }
          }

          prompt = `I want to recreate the ${url} website as a complete React application based on the scraped content below.

${JSON.stringify(scrapeData, null, 2)}

${filteredContext ? `ADDITIONAL CONTEXT/REQUIREMENTS FROM USER:
${filteredContext}

Please incorporate these requirements into the design and implementation.` : ''}

IMPORTANT INSTRUCTIONS:
- Create a COMPLETE, working React application
- Implement ALL sections and features from the original site
- Use Tailwind CSS for all styling (no custom CSS files)
- Make it responsive and modern
- Ensure all text content matches the original
- Create proper component structure
- Make sure the app actually renders visible content
- Create ALL components that you reference in imports
${filteredContext ? '- Apply the user\'s context/theme requirements throughout the application' : ''}

Focus on the key sections and content, making it clean and modern.`;
        }

        setGenerationProgress(prev => ({
          isGenerating: true,
          status: 'Initializing AI...',
          components: [],
          currentComponent: 0,
          streamedCode: '',
          isStreaming: true,
          isThinking: false,
          thinkingText: undefined,
          thinkingDuration: undefined,
          // Keep previous files until new ones are generated
          files: prev.files || [],
          currentFile: undefined,
          lastProcessedPosition: 0
        }));
        
        const genProjectId = currentProjectIdRef.current || (await ensureProjectId());
        const aiResponse = await fetch('/api/generate-ai-code-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model: aiModel,
            projectId: genProjectId || undefined,
            context: {
              sandboxId: sandboxData?.sandboxId,
              structure: structureContent,
              conversationContext: conversationContext
            }
          })
        });
        
        if (!aiResponse.ok || !aiResponse.body) {
          throw new Error('Failed to generate code');
        }
        
        const reader = aiResponse.body.getReader();
        const decoder = new TextDecoder();
        let generatedCode = '';
        let explanation = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'status') {
                  setGenerationProgress(prev => ({ ...prev, status: data.message }));
                } else if (data.type === 'thinking') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: true,
                    thinkingText: (prev.thinkingText || '') + data.text
                  }));
                } else if (data.type === 'thinking_complete') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: false,
                    thinkingDuration: data.duration
                  }));
                } else if (data.type === 'conversation') {
                  // Add conversational text to chat only if it's not code
                  let text = data.text || '';
                  
                  // Remove package tags from the text
                  text = text.replace(/<package>[^<]*<\/package>/g, '');
                  text = text.replace(/<packages>[^<]*<\/packages>/g, '');
                  
                  // Filter out any XML tags and file content that slipped through
                  if (!text.includes('<file') && !text.includes('import React') && 
                      !text.includes('export default') && !text.includes('className=') &&
                      text.trim().length > 0) {
                    addChatMessage(text.trim(), 'ai');
                  }
                } else if (data.type === 'stream' && data.raw) {
                  setGenerationProgress(prev => {
                    const newStreamedCode = prev.streamedCode + data.text;
                    
                    // Tab is already switched after scraping
                    
                    const updatedState = { 
                      ...prev, 
                      streamedCode: newStreamedCode,
                      isStreaming: true,
                      isThinking: false,
                      status: 'Generating code...'
                    };
                    
                    // Process complete files from the accumulated stream
                    const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
                    let match;
                    const processedFiles = new Set(prev.files.map(f => f.path));
                    
                    while ((match = fileRegex.exec(newStreamedCode)) !== null) {
                      const filePath = match[1];
                      const fileContent = match[2];
                      
                      // Only add if we haven't processed this file yet
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        // Check if file already exists
                        const existingFileIndex = updatedState.files.findIndex(f => f.path === filePath);
                        
                        if (existingFileIndex >= 0) {
                          // Update existing file and mark as edited
                          updatedState.files = [
                            ...updatedState.files.slice(0, existingFileIndex),
                            {
                              ...updatedState.files[existingFileIndex],
                              content: fileContent.trim(),
                              type: fileType,
                              completed: true,
                              edited: true
                            },
                            ...updatedState.files.slice(existingFileIndex + 1)
                          ];
                        } else {
                          // Add new file
                          updatedState.files = [...updatedState.files, {
                            path: filePath,
                            content: fileContent.trim(),
                            type: fileType,
                            completed: true,
                            edited: false
                          }];
                        }
                        
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Completed ${filePath}`;
                        }
                        processedFiles.add(filePath);
                      }
                    }
                    
                    // Check for current file being generated (incomplete file at the end)
                    const lastFileMatch = newStreamedCode.match(/<file path="([^"]+)">([^]*?)$/);
                    if (lastFileMatch && !lastFileMatch[0].includes('</file>')) {
                      const filePath = lastFileMatch[1];
                      const partialContent = lastFileMatch[2];
                      
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        updatedState.currentFile = { 
                          path: filePath, 
                          content: partialContent, 
                          type: fileType 
                        };
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Generating ${filePath}`;
                        }
                      }
                    } else {
                      updatedState.currentFile = undefined;
                    }
                    
                    return updatedState;
                  });
                } else if (data.type === 'complete') {
                  generatedCode = data.generatedCode;
                  explanation = data.explanation;
                  
                  // Save the last generated code
                  setConversationContext(prev => ({
                    ...prev,
                    lastGeneratedCode: generatedCode
                  }));
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
            }
          }
        }
        
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: 'Generation complete!'
        }));
        
        if (generatedCode) {
          addChatMessage('AI recreation generated!', 'system');
          
          // Add the explanation to chat if available
          if (explanation && explanation.trim()) {
            addChatMessage(explanation, 'ai');
          }
          
          setPromptInput(generatedCode);

          // Apply the code (first time is not edit mode)
          await applyGeneratedCode(generatedCode, false);

          addChatMessage(
            brandExtensionMode
              ? `Successfully built your custom component using ${cleanUrl}'s brand guidelines! You can now ask me to modify it or add more features.`
              : `Successfully recreated ${url} as a modern React app${homeContextInput ? ` with your requested context: "${homeContextInput}"` : ''}! The scraped content is now in my context, so you can ask me to modify specific sections or add features based on the original site.`,
            'ai',
            {
              scrapedUrl: url,
              scrapedContent: brandExtensionMode ? { brandGuidelines } : scrapeData,
              generatedCode: generatedCode
            }
          );
          
          setConversationContext(prev => ({
            ...prev,
            generatedComponents: [],
            appliedCode: [...prev.appliedCode, {
              files: [],
              timestamp: new Date()
            }]
          }));
        } else {
          throw new Error('Failed to generate recreation');
        }
        
        setUrlInput('');
        setUrlStatus([]);
        setHomeContextInput('');
        
        // Clear generation progress and all screenshot/design states
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: 'Generation complete!'
        }));
        
        // Clear screenshot and preparing design states to prevent them from showing on next run
        setIsScreenshotLoaded(false); // Reset loaded state
        setUrlScreenshot(null);
        setIsPreparingDesign(false);
        setTargetUrl('');
        setScreenshotError(null);
        setLoadingStage(null); // Clear loading stage
        setIsStartingNewGeneration(false); // Clear new generation flag
        setShowLoadingBackground(false); // Clear loading background
        
        setTimeout(() => {
          // Switch back to preview tab but keep files
          setActiveTab('preview');
        }, 1000); // Show completion briefly then switch
      } catch (error: any) {
        addChatMessage(`Failed to clone website: ${error.message}`, 'system');
        setUrlStatus([]);
        setIsPreparingDesign(false);
        setIsStartingNewGeneration(false); // Clear new generation flag on error
        setLoadingStage(null);
        // Also clear generation progress on error
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: '',
          // Keep files to display in sidebar
          files: prev.files
        }));
      }
    }, 500);
  };

  return (
    <HeaderProvider>
      <div style={{ height: '100dvh' }} className="font-sans bg-[#fbfafd] text-[#191622] h-screen flex flex-col">
      {/* Mobile header — hamburger + centered project title + preview toggle.
          Hidden in preview mode so the preview is truly full-screen. */}
      <div className={`relative ${mobileView === 'chat' ? 'flex' : 'hidden'} md:hidden shrink-0 items-center justify-between px-16 pb-10 pt-[max(20px,env(safe-area-inset-top))] bg-[#fbfafd]`}>
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label="Menu"
          className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full border border-[#e2ddf0] bg-white shadow-[0_2px_8px_rgba(23,20,31,0.08)] text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="mx-8 flex min-w-0 items-center gap-6 rounded-full border border-[#e2ddf0] bg-white shadow-[0_2px_8px_rgba(23,20,31,0.08)] px-14 py-8 text-[#191622]"
        >
          <span className="truncate text-[14px] font-medium">{projectName}</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-[#a29db0] transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`}>
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => setMobileView((v) => (v === 'chat' ? 'panel' : 'chat'))}
          aria-label={mobileView === 'chat' ? 'Show preview' : 'Show chat'}
          disabled={mobileView === 'chat' && !sandboxData}
          title={mobileView === 'chat' && !sandboxData ? 'Preview not ready yet' : undefined}
          className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full border border-[#e2ddf0] bg-white shadow-[0_2px_8px_rgba(23,20,31,0.08)] text-[#2a2635] transition-colors hover:bg-[#f3f0fa] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
        >
          {mobileView === 'chat' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMobileMenuOpen(false)} />
            <div className="absolute left-16 right-16 top-full z-50 mt-4 overflow-hidden rounded-12 border border-[#eae6f3] bg-white p-6 shadow-[0_12px_40px_rgba(23,20,31,0.12)]">
              <a
                href="/dashboard"
                className="flex items-center gap-10 rounded-8 px-12 py-10 text-[14px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
              >
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden className="text-[#8b8798]">
                  <path d="M11 5L6 10l5 5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Go to Dashboard
              </a>
              {sandboxData && (
                <button
                  onClick={() => {
                    if (iframeRef.current && sandboxData?.url) iframeRef.current.src = `${sandboxData.url}?t=${Date.now()}`;
                    setMobileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-10 rounded-8 px-12 py-10 text-left text-[14px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden className="text-[#8b8798]">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reload preview
                </button>
              )}
              {sandboxData && (
                <a
                  href={sandboxData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-10 rounded-8 px-12 py-10 text-[14px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden className="text-[#8b8798]">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open in new tab
                </a>
              )}
              <button
                onClick={() => { downloadZip(); setMobileMenuOpen(false); }}
                disabled={!sandboxData}
                className="flex w-full items-center gap-10 rounded-8 px-12 py-10 text-left text-[14px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa] disabled:opacity-40"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden className="text-[#8b8798]">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                Download as ZIP
              </button>
              <div className="my-6 h-px bg-[#eee9f5]" />
              <button
                onClick={() => { deployProject(); setMobileMenuOpen(false); }}
                disabled={!sandboxData || loading}
                className="flex w-full items-center gap-10 rounded-8 px-12 py-10 text-left text-[14px] font-semibold text-[#6147D4] transition-colors hover:bg-[#f3f0fa] disabled:opacity-40"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
                Publish
              </button>
            </div>
          </>
        )}
      </div>

      <div className="h-52 shrink-0 hidden md:flex items-stretch bg-[#fbfafd]">
        {/* Left zone — logo + project name, aligned over the chat panel */}
        <div
          className={`flex min-w-0 items-center gap-8 px-16 ${
            chatFullscreen ? 'flex-1' : 'w-[440px] shrink-0'
          }`}
        >
          <a href="/dashboard" className="shrink-0" title="Back to dashboard">
            <img src="/etlaq-logo.svg" alt="Etlaq" className="h-[22px] w-auto" />
          </a>
          <div className="relative" ref={projectMenuRef}>
            <button
              onClick={() => setProjectMenuOpen((v) => !v)}
              className="flex min-w-0 items-center gap-6 rounded-8 px-6 py-4 text-[#191622] transition-colors hover:bg-[#f3f0fa]"
            >
              <span className="truncate text-[15px] font-medium">{projectName}</span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-[#a29db0] transition-transform ${projectMenuOpen ? 'rotate-180' : ''}`}>
                <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {projectMenuOpen && (
              <div className="absolute left-0 top-full z-40 mt-8 w-[240px] overflow-hidden rounded-12 border border-[#eae6f3] bg-white p-6">
                <a
                  href="/dashboard"
                  className="flex items-center gap-8 rounded-8 px-10 py-8 text-[14px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden className="text-[#8b8798]">
                    <path d="M11 5L6 10l5 5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Go to Dashboard
                </a>
              </div>
            )}
          </div>
          {chatFullscreen && (
            <button
              onClick={() => setChatFullscreen((v) => !v)}
              title="Exit fullscreen"
              className="ml-auto flex h-32 w-32 items-center justify-center rounded-8 text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                <path d="M8 3H5a2 2 0 00-2 2v3M12 3h3a2 2 0 012 2v3M8 17H5a2 2 0 01-2-2v-3M12 17h3a2 2 0 002-2v-3" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Right zone — controls, aligned over the preview panel */}
        {!chatFullscreen && (
          <div className="relative flex-1 flex items-center justify-between px-16">
            {/* Preview / Code toggle */}
            <div className="inline-flex items-center gap-6">
              <button
                onClick={() => setActiveTab('preview')}
                className={`relative flex items-center gap-6 rounded-10 px-12 py-7 text-[13px] font-medium transition-colors ${
                  activeTab === 'preview'
                    ? 'text-[#6147D4]'
                    : 'text-[#6b6577] hover:bg-[#f3f0fa] hover:text-[#191622]'
                }`}
              >
                {activeTab === 'preview' && (
                  <motion.span
                    layoutId="panelTabPill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 z-0 rounded-10 bg-[#f0ecfb]"
                  />
                )}
                <span className="relative z-10 flex items-center gap-6">
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                    <circle cx="10" cy="10" r="7.5" strokeWidth="1.4" />
                    <path d="M2.5 10h15" strokeWidth="1.4" />
                    <path d="M10 2.5c2.2 2.6 2.2 12.4 0 15M10 2.5c-2.2 2.6-2.2 12.4 0 15" strokeWidth="1.4" />
                  </svg>
                  Preview
                </span>
              </button>
              <button
                onClick={() => setActiveTab('generation')}
                className={`relative flex items-center gap-6 rounded-10 px-12 py-7 text-[13px] font-medium transition-colors ${
                  activeTab === 'generation'
                    ? 'text-[#6147D4]'
                    : 'text-[#6b6577] hover:bg-[#f3f0fa] hover:text-[#191622]'
                }`}
              >
                {activeTab === 'generation' && (
                  <motion.span
                    layoutId="panelTabPill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 z-0 rounded-10 bg-[#f0ecfb]"
                  />
                )}
                <span className="relative z-10 flex items-center gap-6">
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                    <path d="M7 6L3 10l4 4M13 6l4 4-4 4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Code
                </span>
              </button>
            </div>

            {/* Center: 'Code' label on the Code tab, device controls on Preview */}
            {activeTab === 'generation' ? (
              <span className="absolute left-1/2 -translate-x-1/2 text-[14px] font-semibold text-[#191622]">
                Code
              </span>
            ) : sandboxData ? (
              <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-8">
                <div className="inline-flex items-center gap-2 rounded-10 bg-[#f3f0fa] p-3">
                  <button
                    onClick={() => setPreviewDevice('desktop')}
                    title="Desktop view"
                    className={`relative flex h-28 w-30 items-center justify-center rounded-8 transition-colors ${
                      previewDevice === 'desktop' ? 'text-[#191622]' : 'text-[#8b8798] hover:text-[#191622]'
                    }`}
                  >
                    {previewDevice === 'desktop' && (
                      <motion.span
                        layoutId="deviceTogglePill"
                        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                        className="absolute inset-0 z-0 rounded-8 bg-white shadow-[0_1px_3px_rgba(23,20,31,0.12)]"
                      />
                    )}
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="relative z-10">
                      <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth="1.7" />
                      <path strokeWidth="1.7" strokeLinecap="round" d="M9 20h6M12 16v4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setPreviewDevice('mobile')}
                    title="Mobile view"
                    className={`relative flex h-28 w-30 items-center justify-center rounded-8 transition-colors ${
                      previewDevice === 'mobile' ? 'text-[#191622]' : 'text-[#8b8798] hover:text-[#191622]'
                    }`}
                  >
                    {previewDevice === 'mobile' && (
                      <motion.span
                        layoutId="deviceTogglePill"
                        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                        className="absolute inset-0 z-0 rounded-8 bg-white shadow-[0_1px_3px_rgba(23,20,31,0.12)]"
                      />
                    )}
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="relative z-10">
                      <rect x="7" y="3" width="10" height="18" rx="2" strokeWidth="1.7" />
                      <path strokeWidth="1.7" strokeLinecap="round" d="M11 18h2" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={() => {
                    if (iframeRef.current && sandboxData?.url) {
                      iframeRef.current.src = `${sandboxData.url}?t=${Date.now()}`;
                    }
                  }}
                  className="flex h-32 w-32 items-center justify-center rounded-8 text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
                  title="Reload preview"
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                <a
                  href={sandboxData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-32 w-32 items-center justify-center rounded-8 text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
                  title="Open in new tab"
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            ) : null}

            {/* Right: download + Publish + fullscreen */}
            <div className="flex items-center gap-6">
              <button
                onClick={downloadZip}
                disabled={!sandboxData}
                className="flex h-32 w-32 items-center justify-center rounded-8 text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622] disabled:opacity-30 disabled:hover:bg-transparent"
                title="Download as ZIP"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
              </button>
              <button
                onClick={deployProject}
                disabled={!sandboxData || loading}
                className="flex items-center gap-6 rounded-10 bg-[#6147D4] px-14 py-7 text-[13px] font-semibold text-white transition-colors hover:bg-[#5238c0] disabled:opacity-40"
                title="Publish your app"
              >
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
                Publish
              </button>
              <div className="mx-4 h-20 w-px bg-[#ece8f4]" />
              <button
                onClick={() => setChatFullscreen((v) => !v)}
                className="flex h-32 w-32 items-center justify-center rounded-8 text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
                title="Fullscreen chat"
              >
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                  <path d="M4 8V5a1 1 0 011-1h3M16 8V5a1 1 0 00-1-1h-3M4 12v3a1 1 0 001 1h3M16 12v3a1 1 0 01-1 1h-3" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Center Panel - AI Chat */}
        <div
          className={`flex-col bg-[#fbfafd] md:flex ${
            mobileView === 'chat' ? 'flex anim-slide-in-left' : 'hidden'
          } ${
            chatFullscreen
              ? 'w-full flex-1 md:items-center'
              : 'w-full md:w-[440px] shrink-0'
          }`}
        >
         <div className={`flex min-h-0 w-full flex-1 flex-col ${chatFullscreen ? 'max-w-[880px]' : ''}`}>
          {/* Sidebar Input Component */}
          {!hasInitialSubmission ? (
            <div className="p-4 border-b border-border">
              <SidebarInput
                onSubmit={(url, style, model, instructions) => {
                  // Mark that we've had an initial submission
                  setHasInitialSubmission(true);
                  
                  // Store the configuration in sessionStorage (same as home page)
                  sessionStorage.setItem('targetUrl', url);
                  sessionStorage.setItem('selectedStyle', style);
                  sessionStorage.setItem('selectedModel', model);
                  if (instructions) {
                    sessionStorage.setItem('additionalInstructions', instructions);
                  }
                  sessionStorage.setItem('autoStart', 'true');
                  
                  // Start generation using the existing logic
                  setHomeUrlInput(url);
                  setHomeContextInput(instructions || '');
                  startGeneration();
                }}
                disabled={loading || generationProgress.isGenerating}
              />
            </div>
          ) : null}

          {conversationContext.scrapedWebsites.length > 0 && (
            <div className="p-4 bg-card border-b border-gray-200">
              <div className="flex flex-col gap-4">
                {conversationContext.scrapedWebsites.map((site, idx) => {
                  // Extract favicon and site info from the scraped data
                  const metadata = site.content?.metadata || {};
                  const sourceURL = metadata.sourceURL || site.url;
                  const favicon = metadata.favicon || `https://www.google.com/s2/favicons?domain=${new URL(sourceURL).hostname}&sz=128`;
                  const siteName = metadata.ogSiteName || metadata.title || new URL(sourceURL).hostname;
                  const screenshot = site.content?.screenshot || sessionStorage.getItem('websiteScreenshot');
                  
                  return (
                    <div key={idx} className="flex flex-col gap-3">
                      {/* Site info with favicon */}
                      <div className="flex items-center gap-4 text-sm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                          src={favicon} 
                          alt={siteName}
                          className="w-16 h-16 rounded"
                          onError={(e) => {
                            e.currentTarget.src = `https://www.google.com/s2/favicons?domain=${new URL(sourceURL).hostname}&sz=128`;
                          }}
                        />
                        <a 
                          href={sourceURL} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-black hover:text-gray-700 truncate max-w-[250px] font-medium"
                          title={sourceURL}
                        >
                          {siteName}
                        </a>
                      </div>
                      
                      {/* Pinned screenshot */}
                      {screenshot && (
                        <div className="w-full">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-600">Screenshot Preview</span>
                            <button
                              onClick={() => setScreenshotCollapsed(!screenshotCollapsed)}
                              className="text-gray-500 hover:text-gray-700 transition-colors p-1"
                              aria-label={screenshotCollapsed ? 'Expand screenshot' : 'Collapse screenshot'}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className={`transition-transform duration-300 ${screenshotCollapsed ? 'rotate-180' : ''}`}
                              >
                                <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                          <div
                            className="w-full rounded-lg overflow-hidden border border-gray-200 transition-all duration-300"
                            style={{
                              opacity: screenshotCollapsed ? 0 : 1,
                              transform: screenshotCollapsed ? 'translateY(-20px)' : 'translateY(0)',
                              pointerEvents: screenshotCollapsed ? 'none' : 'auto',
                              maxHeight: screenshotCollapsed ? '0' : '200px'
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={screenshot}
                              alt={`${siteName} preview`}
                              className="w-full h-auto object-cover"
                              style={{ maxHeight: '200px' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div
            className="flex-1 overflow-y-auto px-20 py-24 flex flex-col gap-24 scrollbar-hide"
            ref={chatMessagesRef}>
            {chatMessages.map((msg, idx) => {
              // Skip stray code fragments that leak from the generation stream
              // (e.g. "; </file>" or a dangling JSX tag) — not meaningful to the user.
              if (msg.type === 'ai') {
                const t = msg.content.trim();
                if (!t || t.startsWith('<') || t.includes('</file>')) return null;
              }

              // Check if this message is from a successful generation
              const isGenerationComplete = msg.content.includes('Successfully recreated') ||
                                         msg.content.includes('AI recreation generated!') ||
                                         msg.content.includes('Code generated!');
              
              // Get the files from metadata if this is a completion message
              // const completedFiles = msg.metadata?.appliedFiles || [];

              // A recorded build step: the list of files that were generated/edited.
              // Kept in the conversation permanently and persisted across reloads.
              if (msg.type === 'build') {
                const builtFiles = msg.metadata?.appliedFiles || [];
                const isOpen = !!openBuildRecords[idx];
                return (
                  <div key={idx} className="anim-fade-up flex w-full flex-col items-start">
                    <div className="w-full overflow-hidden rounded-14 border border-[#ece8f4] bg-white transition-colors">
                      <button
                        onClick={() => setOpenBuildRecords((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                        className="flex w-full items-center gap-10 px-14 py-12 text-left"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#6147D4]" stroke="currentColor">
                          <path className="anim-check-draw" pathLength={1} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="flex-1 text-[14px] font-medium text-[#2a2635]">
                          Built your app · {builtFiles.length} {builtFiles.length === 1 ? 'file' : 'files'}
                        </span>
                        {builtFiles.length > 0 && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-[#a29db0] transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      {isOpen && builtFiles.length > 0 && (
                        <div className="flex flex-col border-t border-[#ece8f4] px-14 py-4">
                          {builtFiles.map((f, i) => (
                            <div
                              key={`built-${idx}-${i}`}
                              className="flex w-full items-center gap-8 border-b border-[#f2eff8] py-8 text-[13px] text-[#2a2635] last:border-0"
                            >
                              <svg width="15" height="15" className="shrink-0 text-[#6147D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path className="anim-check-draw" pathLength={1} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="truncate">{f.split('/').pop()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key={idx} className={`anim-fade-up flex flex-col gap-8 ${msg.type === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`${
                        isGenerationComplete && idx === chatMessages.length - 1 ? 'anim-pulse-glow ' : ''
                      }${
                        msg.type === 'user' ? 'max-w-[82%] rounded-[20px] bg-[#e5dcf6] px-16 py-12 text-[15px] leading-relaxed text-[#191622]' :
                        msg.type === 'ai' ? 'max-w-[94%] rounded-16 border border-[#e7e3f0] bg-white px-16 py-14 text-[15px] leading-[1.6] text-[#2a2635]' :
                        msg.type === 'system' ? 'max-w-[94%] text-[14px] leading-relaxed text-[#8b8798]' :
                        msg.type === 'command' ? 'max-w-[94%] rounded-12 bg-[#f6f4fb] px-14 py-10 font-mono text-[13px] text-[#2a2635] border border-[#eee9f5]' :
                        msg.type === 'error' ? 'max-w-[94%] rounded-14 bg-[#fdf0ee] px-14 py-12 text-[14px] text-[#b23b2e] border border-[#f4d6d0]' :
                        'max-w-[94%] text-[14px] text-[#8b8798]'
                      }`}>
                    {msg.type === 'command' ? (
                      <div className="flex items-start gap-2">
                        <span className={`text-xs ${
                          msg.metadata?.commandType === 'input' ? 'text-blue-400' :
                          msg.metadata?.commandType === 'error' ? 'text-red-400' :
                          msg.metadata?.commandType === 'success' ? 'text-green-400' :
                          'text-gray-500'
                        }`}>
                          {msg.metadata?.commandType === 'input' ? '$' : '>'}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap text-[#2a2635]">{msg.content}</span>
                      </div>
                    ) : msg.type === 'error' ? (
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-[#f4d6d0] rounded-full flex items-center justify-center">
                            <svg className="w-6 h-6 text-[#b23b2e]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold mb-1">Build Errors Detected</div>
                          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                          <div className="mt-2 text-xs opacity-70">Press 'F' or click the Fix button above to resolve</div>
                        </div>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                      </div>

                      {/* Preview / code actions on the final message once the app is ready */}
                      {msg.type === 'ai' && idx === chatMessages.length - 1 && sandboxData?.url && !generationProgress.isGenerating && (
                        <div className="anim-fade-up mt-10 flex flex-wrap gap-8">
                          <button
                            onClick={() => { setChatFullscreen(false); setActiveTab('preview'); setMobileView('panel'); }}
                            className="flex items-center gap-6 rounded-10 bg-[#f0ecfb] px-14 py-8 text-[13px] font-medium text-[#6147D4] transition-all hover:bg-[#e7e0f8] active:scale-[0.97]"
                          >
                            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                              <circle cx="10" cy="10" r="7.5" strokeWidth="1.4" />
                              <path d="M2.5 10h15" strokeWidth="1.4" />
                              <path d="M10 2.5c2.2 2.6 2.2 12.4 0 15M10 2.5c-2.2 2.6-2.2 12.4 0 15" strokeWidth="1.4" />
                            </svg>
                            Preview
                          </button>
                          <button
                            onClick={() => { setChatFullscreen(false); setActiveTab('generation'); setMobileView('panel'); }}
                            className="flex items-center gap-6 rounded-10 border border-[#b7abdd] bg-white px-14 py-8 text-[13px] font-medium text-[#5b5668] transition-all hover:border-[#6147D4] hover:text-[#191622] hover:bg-[#faf9fe] active:scale-[0.97]"
                          >
                            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                              <path d="M7 6L3 10l4 4M13 6l4 4-4 4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            View code
                          </button>
                        </div>
                      )}

                      {/* Show branding data if this is a brand extraction message */}
                      {msg.metadata?.brandingData && (
                        <div className="mt-3 bg-gradient-to-br from-gray-50 to-white border-2 border-gray-200 rounded-xl overflow-hidden max-w-[500px]">
                          <div className="bg-[#36322F] px-16 py-12">
                            <div className="flex items-center gap-8">
                              <Image
                                src={`https://www.google.com/s2/favicons?domain=${msg.metadata.sourceUrl}&sz=32`}
                                alt=""
                                width={64}
                                height={64}
                                className="w-16 h-16"
                              />
                              <div className="text-sm font-semibold text-white">
                                Brand Guidelines
                              </div>
                            </div>
                          </div>

                          <div className="p-16">
                            {/* Color Scheme Mode */}
                            {msg.metadata.brandingData.colorScheme && (
                              <div className="mb-16">
                                <div className="text-sm">
                                  <span className="text-gray-600 font-medium">Mode:</span>{' '}
                                  <span className="font-semibold text-gray-900 capitalize">{msg.metadata.brandingData.colorScheme}</span>
                                </div>
                              </div>
                            )}

                            {/* Colors */}
                            {msg.metadata.brandingData.colors && (
                              <div className="mb-16">
                                <div className="text-sm font-semibold text-gray-900 mb-8">Colors</div>
                                <div className="flex flex-wrap gap-12">
                                  {msg.metadata.brandingData.colors.primary && (
                                    <div className="flex items-center gap-8">
                                      <div className="w-32 h-32 rounded border border-gray-300" style={{ backgroundColor: msg.metadata.brandingData.colors.primary }} />
                                      <div className="text-sm">
                                        <div className="font-semibold text-gray-900">Primary</div>
                                        <div className="text-gray-600 font-mono text-xs">{msg.metadata.brandingData.colors.primary}</div>
                                      </div>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.colors.accent && (
                                    <div className="flex items-center gap-8">
                                      <div className="w-32 h-32 rounded border border-gray-300" style={{ backgroundColor: msg.metadata.brandingData.colors.accent }} />
                                      <div className="text-sm">
                                        <div className="font-semibold text-gray-900">Accent</div>
                                        <div className="text-gray-600 font-mono text-xs">{msg.metadata.brandingData.colors.accent}</div>
                                      </div>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.colors.background && (
                                    <div className="flex items-center gap-8">
                                      <div className="w-32 h-32 rounded border border-gray-300" style={{ backgroundColor: msg.metadata.brandingData.colors.background }} />
                                      <div className="text-sm">
                                        <div className="font-semibold text-gray-900">Background</div>
                                        <div className="text-gray-600 font-mono text-xs">{msg.metadata.brandingData.colors.background}</div>
                                      </div>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.colors.textPrimary && (
                                    <div className="flex items-center gap-8">
                                      <div className="w-32 h-32 rounded border border-gray-300" style={{ backgroundColor: msg.metadata.brandingData.colors.textPrimary }} />
                                      <div className="text-sm">
                                        <div className="font-semibold text-gray-900">Text</div>
                                        <div className="text-gray-600 font-mono text-xs">{msg.metadata.brandingData.colors.textPrimary}</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Typography */}
                            {msg.metadata.brandingData.typography && (
                              <div className="mb-16">
                                <div className="text-sm font-semibold text-gray-900 mb-8">Typography</div>
                                <div className="grid grid-cols-2 gap-12 text-sm">
                                  {msg.metadata.brandingData.typography.fontFamilies?.primary && (
                                    <div>
                                      <span className="text-gray-600 font-medium">Primary:</span>{' '}
                                      <span className="font-semibold text-gray-900">{msg.metadata.brandingData.typography.fontFamilies.primary}</span>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.typography.fontFamilies?.heading && (
                                    <div>
                                      <span className="text-gray-600 font-medium">Heading:</span>{' '}
                                      <span className="font-semibold text-gray-900">{msg.metadata.brandingData.typography.fontFamilies.heading}</span>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.typography.fontSizes?.h1 && (
                                    <div>
                                      <span className="text-gray-600 font-medium">H1 Size:</span>{' '}
                                      <span className="font-semibold text-gray-900">{msg.metadata.brandingData.typography.fontSizes.h1}</span>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.typography.fontSizes?.h2 && (
                                    <div>
                                      <span className="text-gray-600 font-medium">H2 Size:</span>{' '}
                                      <span className="font-semibold text-gray-900">{msg.metadata.brandingData.typography.fontSizes.h2}</span>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.typography.fontSizes?.body && (
                                    <div>
                                      <span className="text-gray-600 font-medium">Body Size:</span>{' '}
                                      <span className="font-semibold text-gray-900">{msg.metadata.brandingData.typography.fontSizes.body}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Spacing */}
                            {msg.metadata.brandingData.spacing && (
                              <div className="mb-16">
                                <div className="text-sm font-semibold text-gray-900 mb-8">Spacing</div>
                                <div className="flex flex-wrap gap-16 text-sm">
                                  {msg.metadata.brandingData.spacing.baseUnit && (
                                    <div>
                                      <span className="text-gray-600 font-medium">Base Unit:</span>{' '}
                                      <span className="font-semibold text-gray-900">{msg.metadata.brandingData.spacing.baseUnit}px</span>
                                    </div>
                                  )}
                                  {msg.metadata.brandingData.spacing.borderRadius && (
                                    <div>
                                      <span className="text-gray-600 font-medium">Border Radius:</span>{' '}
                                      <span className="font-semibold text-gray-900">{msg.metadata.brandingData.spacing.borderRadius}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Button Styles */}
                            {msg.metadata.brandingData.components?.buttonPrimary && (
                              <div className="mb-16">
                                <div className="text-sm font-semibold text-gray-900 mb-8">Button Styles</div>
                                <div className="flex flex-wrap gap-12">
                                  <div>
                                    <div className="text-xs text-gray-600 mb-6 font-medium">Primary Button</div>
                                    <button
                                      className="px-16 py-8 text-sm font-medium"
                                      style={{
                                        backgroundColor: msg.metadata.brandingData.components.buttonPrimary.background,
                                        color: msg.metadata.brandingData.components.buttonPrimary.textColor,
                                        borderRadius: msg.metadata.brandingData.components.buttonPrimary.borderRadius,
                                        boxShadow: msg.metadata.brandingData.components.buttonPrimary.shadow
                                      }}
                                    >
                                      Sample Button
                                    </button>
                                  </div>
                                  {msg.metadata.brandingData.components?.buttonSecondary && (
                                    <div>
                                      <div className="text-xs text-gray-600 mb-6 font-medium">Secondary Button</div>
                                      <button
                                        className="px-16 py-8 text-sm font-medium"
                                        style={{
                                          backgroundColor: msg.metadata.brandingData.components.buttonSecondary.background,
                                          color: msg.metadata.brandingData.components.buttonSecondary.textColor,
                                          borderRadius: msg.metadata.brandingData.components.buttonSecondary.borderRadius,
                                          boxShadow: msg.metadata.brandingData.components.buttonSecondary.shadow
                                        }}
                                      >
                                        Sample Button
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Personality */}
                            {msg.metadata.brandingData.personality && (
                              <div className="text-sm">
                                <span className="text-gray-600 font-medium">Personality:</span>{' '}
                                <span className="font-semibold text-gray-900 capitalize">
                                  {msg.metadata.brandingData.personality.tone} tone, {msg.metadata.brandingData.personality.energy} energy
                                </span>
                              </div>
                            )}

                            {/* Target Audience */}
                            {msg.metadata.brandingData.personality?.targetAudience && (
                              <div className="text-sm mt-8">
                                <span className="text-gray-600 font-medium">Target:</span>{' '}
                                <span className="text-gray-900">{msg.metadata.brandingData.personality.targetAudience}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* File-chip lists removed — too technical for end users */}
                </div>
              );
            })}
            
            {/* Code application progress */}
            {codeApplicationState.stage && (
              <CodeApplicationProgress state={codeApplicationState} />
            )}

            {/* Deploy / publish status — tags + live URL actions */}
            {deployStatus && <DeployStatus state={deployStatus} />}

            {/* Setting up the workspace (sandbox provisioning) before the build starts */}
            {preparingBuild && !generationProgress.isGenerating && (
              <div className="anim-fade-up flex items-center rounded-14 border border-[#ece8f4] bg-white px-14 py-12">
                <span className="etlaq-shimmer text-[14px] font-medium">
                  Setting up your workspace…
                </span>
              </div>
            )}

            {/* Build progress — compact, friendly, expandable */}
            {generationProgress.isGenerating && (
              <div className="anim-fade-up overflow-hidden rounded-14 border border-[#ece8f4] bg-white">
                <button
                  onClick={() => setBuildDetailsOpen((v) => !v)}
                  className="flex w-full items-center gap-10 px-14 py-12 text-left"
                >
                  <span className="etlaq-shimmer flex-1 text-[14px] font-medium">
                    {generationProgress.isThinking ? 'Planning your app…' : 'Building your app…'}
                  </span>
                  {generationProgress.currentFile?.path && (
                    <span className="min-w-0 shrink truncate font-mono text-[12px] text-[#a29db0]">
                      {generationProgress.currentFile.path.split('/').pop()}
                    </span>
                  )}
                  {(generationProgress.files.length > 0 || generationProgress.streamedCode) && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      className={`shrink-0 text-[#a29db0] transition-transform ${buildDetailsOpen ? 'rotate-180' : ''}`}
                    >
                      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                {/* Details (collapsed by default) */}
                {buildDetailsOpen && (generationProgress.files.length > 0 || generationProgress.streamedCode) && (
                  <div className="border-t border-[#ece8f4] px-14 py-12">
                    {generationProgress.status && (
                      <div className="mb-8 text-[12px] font-medium text-[#8b8798]">{generationProgress.status}</div>
                    )}
                    <div className="flex flex-col">
                      {generationProgress.files.map((file, idx) => (
                        <div
                          key={`file-${idx}`}
                          className="flex w-full items-center gap-8 border-b border-[#f2eff8] py-8 text-[13px] text-[#2a2635] last:border-0"
                        >
                          <svg width="15" height="15" className="shrink-0 text-[#6147D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path className="anim-check-draw" pathLength={1} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="truncate">{file.path.split('/').pop()}</span>
                        </div>
                      ))}
                      {generationProgress.currentFile && (
                        <div className="flex w-full items-center gap-8 border-b border-[#f2eff8] py-8 text-[13px] text-[#2a2635] last:border-0">
                          <div className="w-15 h-15 shrink-0 border-2 border-[#6147D4] border-t-transparent rounded-full animate-spin" />
                          <span className="truncate">{generationProgress.currentFile.path.split('/').pop()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Follow-up suggestion chips (after a build completes) */}
          {sandboxData && !generationProgress.isGenerating && conversationContext.appliedCode.length > 0 && (
            <div className="flex flex-nowrap gap-8 overflow-x-auto px-16 pb-4 scrollbar-hide md:flex-wrap">
              {['Make it responsive', 'Add a dark mode toggle', 'Improve the styling', 'Add animations'].map((s, i) => (
                <button
                  key={s}
                  onClick={() => sendChatMessage(s)}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="group anim-fade-up inline-flex shrink-0 items-center gap-4 whitespace-nowrap rounded-full border border-[#a99cd9] bg-white px-14 py-8 text-[13px] font-medium text-[#5b5668] transition-all hover:border-[#6147D4] hover:bg-[#faf9fe] hover:text-[#191622] active:scale-[0.97]"
                >
                  {s}
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    aria-hidden
                    className="-translate-x-1 text-[#6147D4] opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                  >
                    <path d="M10 4v12M4 10h12" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              ))}
            </div>
          )}

          <div className="px-16 pt-16 pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="rounded-20 border border-[#e7e3f0] bg-white p-10 transition-colors focus-within:border-[#c3b8ee]">
              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div className="mb-8 flex flex-wrap gap-8">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="group relative flex items-center gap-8 rounded-10 border border-[#e7e3f0] bg-[#faf9fc] py-6 pl-8 pr-24 text-[13px] text-[#2a2635]"
                    >
                      {a.kind === 'image' && a.dataUrl ? (
                        <img src={a.dataUrl} alt="" className="h-28 w-28 rounded-6 object-cover" />
                      ) : (
                        <span className="flex h-28 w-28 items-center justify-center rounded-6 bg-[#f0ecfb] text-[#6147D4]">
                          <FiFile style={{ width: '15px', height: '15px' }} />
                        </span>
                      )}
                      <span className="max-w-[140px] truncate">{a.name}</span>
                      {a.kind === 'image' && (
                        <span className="rounded-4 bg-[#eee9f5] px-4 text-[10px] font-medium text-[#8b8798]" title="Image preview only — the AI can't read images yet">
                          soon
                        </span>
                      )}
                      <button
                        onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                        className="absolute right-6 top-1/2 -translate-y-1/2 text-[#a29db0] hover:text-[#191622]"
                        aria-label="Remove attachment"
                      >
                        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                          <path d="M5 5l10 10M15 5L5 15" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {attachments.some((a) => a.kind === 'image') && (
                <p className="mb-8 px-4 text-[12px] text-[#a29db0]">
                  Images are attached for reference — reading images is coming soon.
                </p>
              )}

              <textarea
                value={aiChatInput}
                onChange={(e) => setAiChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleComposerSend();
                  }
                }}
                rows={1}
                disabled={generationProgress.isGenerating || preparingBuild}
                placeholder={generationProgress.isGenerating || preparingBuild ? 'Building your app…' : 'Ask Etlaq…'}
                className="max-h-[160px] min-h-[40px] w-full resize-none bg-transparent px-8 py-6 text-[15px] leading-relaxed text-[#191622] placeholder:text-[#a29db0] focus:outline-none disabled:cursor-not-allowed"
              />
              <div className="mt-6 flex items-center justify-between">
                {/* Attach ("+") */}
                <div className="relative" ref={attachMenuRef}>
                  <input
                    ref={attachInputRef}
                    type="file"
                    multiple
                    accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.csv"
                    className="hidden"
                    onChange={(e) => {
                      handleAttachFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    onClick={() => setAttachMenuOpen((v) => !v)}
                    aria-label="Add attachment"
                    className="flex h-32 w-32 items-center justify-center rounded-full text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
                  >
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                      <path d="M10 4v12M4 10h12" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </button>
                  {attachMenuOpen && (
                    <div className="absolute bottom-full left-0 z-40 mb-8 w-[220px] overflow-hidden rounded-12 border border-[#eae6f3] bg-white p-6 animate-in fade-in slide-in-from-bottom-1 duration-150">
                      <button
                        onClick={() => {
                          setAttachMenuOpen(false);
                          attachInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-10 rounded-8 px-10 py-8 text-left text-[14px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
                      >
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="text-[#8b8798]">
                          <path d="M13 7l-5 5a2 2 0 002.8 2.8l5.7-5.7a3.5 3.5 0 00-5-5l-6 6a5 5 0 007 7l4.5-4.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Attach file or image
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {/* Live waveform while dictating */}
                  {micListening && (
                    <div className="anim-scale-in mr-2 flex items-center gap-8 rounded-full bg-[#f3f0fa] px-10 py-5">
                      <VoiceWaveform level={micLevel} />
                      <span className="text-[11px] font-medium text-[#6147D4]">Listening…</span>
                    </div>
                  )}
                  {/* Voice dictation */}
                  {micSupported && (
                    <button
                      onClick={toggleMic}
                      disabled={generationProgress.isGenerating || preparingBuild}
                      aria-label={micListening ? 'Stop dictation' : 'Dictate with microphone'}
                      aria-pressed={micListening}
                      title={micListening ? 'Stop dictation' : 'Dictate'}
                      className={`relative flex h-36 w-36 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        micListening
                          ? 'bg-[#6147D4] text-white'
                          : 'text-[#8b8798] hover:bg-[#f3f0fa] hover:text-[#191622]'
                      }`}
                    >
                      {micListening ? (
                        <>
                          <span
                            className="absolute inset-0 rounded-full bg-[#6147D4]/25"
                            style={{ transform: `scale(${1 + micLevel * 0.5})`, transition: 'transform 100ms ease-out' }}
                            aria-hidden
                          />
                          <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden className="relative">
                            <rect x="5" y="5" width="10" height="10" rx="2.5" />
                          </svg>
                        </>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden className="relative">
                          <rect x="7.25" y="2.5" width="5.5" height="9" rx="2.75" strokeWidth="1.5" />
                          <path d="M4.5 9a5.5 5.5 0 0011 0M10 14.5v3M7 17.5h6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  )}
                  <button
                  onClick={() => { stopMic(); handleComposerSend(); }}
                  disabled={
                    generationProgress.isGenerating ||
                    preparingBuild ||
                    (!aiChatInput.trim() && attachments.length === 0)
                  }
                  aria-label="Send"
                  className="flex h-36 w-36 items-center justify-center rounded-full bg-[#6147D4] text-white transition-all hover:bg-[#5238c0] hover:scale-105 disabled:cursor-not-allowed disabled:bg-[#cabff1] disabled:hover:scale-100"
                >
                  {generationProgress.isGenerating || preparingBuild ? (
                    <div className="w-16 h-16 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
                      <path d="M10 16V4M10 4L5 9M10 4L15 9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                </div>
              </div>
            </div>
          </div>
         </div>
        </div>

        {/* Right Panel - Preview or Generation.
            Desktop: shown when not fullscreen chat. Mobile: shown when mobileView === 'panel'. */}
        <div
          className={`flex-1 flex-col overflow-hidden bg-[#fbfafd] p-0 md:p-8 ${
            mobileView === 'panel' ? 'flex anim-slide-in-right' : 'hidden'
          } ${chatFullscreen ? 'md:hidden' : 'md:flex'}`}
        >
          <div className="flex-1 relative overflow-hidden border-0 bg-white md:rounded-12 md:border md:border-[#ece8f4]">
            {/* Keyed so switching Preview ⇄ Code crossfades the panel. */}
            <div key={activeTab} className="anim-fade-in h-full w-full">
              {renderMainContent()}
            </div>
          </div>

          {/* Mobile-only bottom bar: back to chat + utilities */}
          <div className="flex items-center justify-between gap-8 px-16 pt-10 pb-[max(10px,env(safe-area-inset-bottom))] md:hidden">
            <button
              onClick={() => setMobileView('chat')}
              className="flex items-center gap-6 rounded-full border border-[#e2ddf0] bg-white shadow-[0_2px_8px_rgba(23,20,31,0.08)] px-16 py-9 text-[14px] font-medium text-[#191622] transition-colors hover:bg-[#f3f0fa]"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                <path d="M12 5l-5 5 5 5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Chat
            </button>
            <div className="flex items-center gap-8">
              <button
                onClick={() => setActiveTab((t) => (t === 'preview' ? 'generation' : 'preview'))}
                aria-label={activeTab === 'preview' ? 'View code' : 'View preview'}
                className={`flex h-40 w-40 items-center justify-center rounded-full border shadow-[0_2px_8px_rgba(23,20,31,0.08)] transition-colors ${
                  activeTab === 'generation'
                    ? 'border-[#c3b8ee] bg-[#f0ecfb] text-[#6147D4]'
                    : 'border-[#e2ddf0] bg-white text-[#2a2635] hover:bg-[#f3f0fa]'
                }`}
              >
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                  <path d="M7 6L3 10l4 4M13 6l4 4-4 4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                onClick={() => {
                  if (iframeRef.current && sandboxData?.url) iframeRef.current.src = `${sandboxData.url}?t=${Date.now()}`;
                }}
                disabled={!sandboxData}
                aria-label="Reload preview"
                className="flex h-40 w-40 items-center justify-center rounded-full border border-[#e2ddf0] bg-white shadow-[0_2px_8px_rgba(23,20,31,0.08)] text-[#2a2635] transition-colors hover:bg-[#f3f0fa] disabled:opacity-40"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <a
                href={sandboxData?.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in new tab"
                className={`flex h-40 w-40 items-center justify-center rounded-full border border-[#e2ddf0] bg-white shadow-[0_2px_8px_rgba(23,20,31,0.08)] text-[#2a2635] outline-none transition-colors hover:bg-[#f3f0fa] focus:outline-none focus-visible:outline-none ${!sandboxData ? 'pointer-events-none opacity-40' : ''}`}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              <button
                onClick={deployProject}
                disabled={!sandboxData || loading || deployStatus?.stage === 'publishing'}
                aria-label="Publish your app"
                className="flex h-40 items-center gap-6 rounded-full bg-[#6147D4] px-16 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(97,71,212,0.28)] transition-colors hover:bg-[#5238c0] disabled:opacity-40"
              >
                {deployStatus?.stage === 'publishing' ? (
                  <span className="h-15 w-15 animate-spin rounded-full border-[1.6px] border-white/40 border-t-white" />
                ) : (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                )}
                Publish
              </button>
            </div>
          </div>
        </div>
      </div>




    </div>
    </HeaderProvider>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <AISandboxPage />
    </Suspense>
  );
}