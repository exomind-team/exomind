import { spawn } from "child_process";

export async function waitProcess(child: ReturnType<typeof spawn>) {
    return new Promise((resolve) => {
        child.on("close", resolve);
    });
}

export function isWindows(): boolean {
    return process.platform === "win32";
}
