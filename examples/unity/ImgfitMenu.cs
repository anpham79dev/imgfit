// Unity Editor: a Tools/imgfit menu that runs imgfit for the project.
// Put this file in Assets/Editor/. Requires imgfit.json at the project root (next to Assets/).
// Binary lookup: IMGFIT_BIN, otherwise "imgfit" on PATH (portable bundle: point IMGFIT_BIN at imgfit.cmd / imgfit).
#if UNITY_EDITOR
using System;
using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEngine;
using Debug = UnityEngine.Debug;

public static class ImgfitMenu
{
    [MenuItem("Tools/imgfit/Run (incremental)")]
    public static void Run() => Exec(new[] { "run", "--json" }, refresh: true);

    [MenuItem("Tools/imgfit/Dry run")]
    public static void DryRun() => Exec(new[] { "run", "--dry-run", "--json" }, refresh: false);

    [MenuItem("Tools/imgfit/Check")]
    public static void Check() => Exec(new[] { "check", "--json" }, refresh: false);

    static void Exec(string[] args, bool refresh)
    {
        var projectRoot = Directory.GetParent(Application.dataPath)!.FullName;
        var bin = Environment.GetEnvironmentVariable("IMGFIT_BIN");
        if (string.IsNullOrEmpty(bin)) bin = Application.platform == RuntimePlatform.WindowsEditor ? "imgfit.cmd" : "imgfit";

        var psi = new ProcessStartInfo(bin)
        {
            WorkingDirectory = projectRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        // ArgumentList: one element per argument, no string joining → no quoting bugs
        foreach (var a in args) psi.ArgumentList.Add(a);

        try
        {
            using var p = Process.Start(psi)!;
            var stdout = p.StandardOutput.ReadToEnd();
            var stderr = p.StandardError.ReadToEnd();
            p.WaitForExit();
            // stdout is JSON (result.schema.json). Only a summary is logged here; parse with JsonUtility/Newtonsoft if needed.
            var summary = stdout.Length > 4000 ? stdout.Substring(0, 4000) + "…" : stdout;
            if (p.ExitCode == 0) Debug.Log($"imgfit {string.Join(" ", args)} → OK\n{summary}");
            else Debug.LogError($"imgfit {string.Join(" ", args)} → exit {p.ExitCode}\n{summary}\n{stderr}");
        }
        catch (Exception e)
        {
            Debug.LogError($"Không chạy được imgfit ({bin}): {e.Message}. Đặt IMGFIT_BIN hoặc thêm imgfit vào PATH.");
            return;
        }

        // Images are replaced in place (.meta/GUID kept); Unity only needs to re-import.
        if (refresh) AssetDatabase.Refresh();
    }
}
#endif
