import { NextResponse } from 'next/server';

declare global {
  var activeSandboxProvider: any;
}

export async function POST() {
  try {
    const provider = global.activeSandboxProvider;
    if (!provider) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox'
      }, { status: 400 });
    }

    console.log('[create-zip] Creating project zip...');

    // Create zip of the app (excluding build artifacts and deps) inside the sandbox
    const zipResult = await provider.runShell(
      'rm -f /tmp/project.zip && zip -r /tmp/project.zip . -x "node_modules/*" ".git/*" ".next/*" "dist/*" "build/*" "*.log"'
    );

    if (!zipResult.success) {
      throw new Error(`Failed to create zip: ${zipResult.stderr || zipResult.stdout}`);
    }

    // Read the zip out of the sandbox as base64
    const base64Content = await provider.readBinaryFileBase64('/tmp/project.zip');
    console.log(`[create-zip] Created project.zip (${base64Content.length} base64 chars)`);

    // Create a data URL for download
    const dataUrl = `data:application/zip;base64,${base64Content}`;

    return NextResponse.json({
      success: true,
      dataUrl,
      fileName: 'sandbox-project.zip',
      message: 'Zip file created successfully'
    });

  } catch (error) {
    console.error('[create-zip] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message
      },
      { status: 500 }
    );
  }
}
