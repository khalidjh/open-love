import { NextRequest, NextResponse } from 'next/server';
import { parseJavaScriptFile, buildComponentTree } from '@/lib/file-parser';
import { FileManifest, FileInfo, RouteInfo } from '@/types/file-manifest';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';

// GET /api/get-sandbox-files?projectId=...
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
  let session;
  try {
    ({ session } = await requireProjectSession(projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
  try {
    const provider = session.provider;
    if (!provider) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox'
      }, { status: 404 });
    }

    console.log('[get-sandbox-files] Fetching and analyzing file structure...');

    // List relevant files via the provider abstraction (works for E2B + Vercel)
    const allFiles: string[] = await provider.listFiles();
    const codeFiles = allFiles
      .map((f) => f.replace(/^\.?\//, ''))
      .filter((f) => /\.(jsx?|tsx?|css|json)$/.test(f));
    console.log('[get-sandbox-files] Found', codeFiles.length, 'code files');

    // Read content of each file (skip large ones)
    const filesContent: Record<string, string> = {};
    for (const relativePath of codeFiles) {
      try {
        const content = await provider.readFile(relativePath);
        if (typeof content === 'string' && content.length < 10000) {
          filesContent[relativePath] = content;
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    // Derive directory structure from the file paths
    const dirSet = new Set<string>();
    for (const p of Object.keys(filesContent)) {
      const parts = p.split('/');
      parts.pop();
      let cur = '';
      for (const seg of parts) {
        cur = cur ? `${cur}/${seg}` : seg;
        dirSet.add(cur);
      }
    }
    const structure = Array.from(dirSet).sort().slice(0, 50).join('\n');
    
    // Build enhanced file manifest
    const fileManifest: FileManifest = {
      files: {},
      routes: [],
      componentTree: {},
      entryPoint: '',
      styleFiles: [],
      timestamp: Date.now(),
    };
    
    // Process each file
    for (const [relativePath, content] of Object.entries(filesContent)) {
      const fullPath = `/${relativePath}`;
      
      // Create base file info
      const fileInfo: FileInfo = {
        content: content,
        type: 'utility',
        path: fullPath,
        relativePath,
        lastModified: Date.now(),
      };
      
      // Parse JavaScript/JSX files
      if (relativePath.match(/\.(jsx?|tsx?)$/)) {
        const parseResult = parseJavaScriptFile(content, fullPath);
        Object.assign(fileInfo, parseResult);
        
        // Identify entry point
        if (relativePath === 'src/main.jsx' || relativePath === 'src/index.jsx') {
          fileManifest.entryPoint = fullPath;
        }
        
        // Identify App.jsx
        if (relativePath === 'src/App.jsx' || relativePath === 'App.jsx') {
          fileManifest.entryPoint = fileManifest.entryPoint || fullPath;
        }
      }
      
      // Track style files
      if (relativePath.endsWith('.css')) {
        fileManifest.styleFiles.push(fullPath);
        fileInfo.type = 'style';
      }
      
      fileManifest.files[fullPath] = fileInfo;
    }
    
    // Build component tree
    fileManifest.componentTree = buildComponentTree(fileManifest.files);
    
    // Extract routes (simplified - looks for Route components or page pattern)
    fileManifest.routes = extractRoutes(fileManifest.files);
    
    // Update the project session's file cache with the manifest
    if (session.fileCache) {
      session.fileCache.manifest = fileManifest;
    }

    return NextResponse.json({
      success: true,
      files: filesContent,
      structure,
      fileCount: Object.keys(filesContent).length,
      manifest: fileManifest,
    });

  } catch (error) {
    console.error('[get-sandbox-files] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

function extractRoutes(files: Record<string, FileInfo>): RouteInfo[] {
  const routes: RouteInfo[] = [];
  
  // Look for React Router usage
  for (const [path, fileInfo] of Object.entries(files)) {
    if (fileInfo.content.includes('<Route') || fileInfo.content.includes('createBrowserRouter')) {
      // Extract route definitions (simplified)
      const routeMatches = fileInfo.content.matchAll(/path=["']([^"']+)["'].*(?:element|component)={([^}]+)}/g);
      
      for (const match of routeMatches) {
        const [, routePath] = match;
        // componentRef available in match but not used currently
        routes.push({
          path: routePath,
          component: path,
        });
      }
    }
    
    // Check for Next.js style pages
    if (fileInfo.relativePath.startsWith('pages/') || fileInfo.relativePath.startsWith('src/pages/')) {
      const routePath = '/' + fileInfo.relativePath
        .replace(/^(src\/)?pages\//, '')
        .replace(/\.(jsx?|tsx?)$/, '')
        .replace(/index$/, '');
        
      routes.push({
        path: routePath,
        component: path,
      });
    }
  }
  
  return routes;
}