# IMGFIT — Kế hoạch kỹ thuật (sẵn sàng triển khai)

> **Ngày cập nhật:** 14/11/2026  
> **Trạng thái:** Đợt 1–5 đã triển khai, Đợt 6 làm một phần (v0.1.0) — xem §13.  
> **Mục tiêu:** Một công cụ **độc lập, không gắn với dự án, ngôn ngữ hay framework nào** để tối ưu, chuẩn hóa và kiểm tra asset ảnh trước khi đưa vào repository. Mọi dự án — Node, Python, PHP/Laravel, Rust, C#/Unity, shell/CI… — dùng chung qua **CLI có hợp đồng JSON ổn định**; Node có thêm API import trực tiếp; kèm web UI chạy cục bộ.  
> **Nguyên tắc:** Dễ dùng, bảo toàn dữ liệu, kết quả có thể tái lập, an toàn mặc định, đo hiệu năng thực tế. **Không biến thành dịch vụ xử lý ảnh upload production.**

## 0. Quyết định và phạm vi

### 0.1. Giữ nguyên giá trị của bản gốc

- **Một repo, TypeScript/Node.js**; core dùng **Sharp/libvips**, CLI dùng Commander, cấu hình JSON Schema/Ajv, glob bằng fast-glob, test Vitest.
- **Web UI Vue 3 + Vite + TypeScript**, backend **Express** chỉ chạy local; Axios là tùy chọn, không bắt buộc.
- **Xử lý hàng loạt** là workflow chính; queue trong tiến trình bằng p-limit, **không Redis/BullMQ**, không DB.
- **Giao diện chung là CLI + JSON có version** (§6.2): ngôn ngữ nào chạy được tiến trình con và đọc JSON là dùng được. Không viết lại core bằng ngôn ngữ khác, không cần SDK riêng từng ngôn ngữ ở v1.
- **Core không chứa logic riêng của framework/dự án nào.** Mọi thứ đặc thù (đường dẫn, preset, tên file, quy ước Unity/Laravel…) nằm trong `imgfit.json` của dự án dùng nó hoặc trong `profile` (chỉ là bộ giá trị mặc định).
- **Nguồn ảnh chất lượng cao ngoài repo**; ảnh đã tối ưu mới vào repo; không tự sửa lịch sử Git LFS.
- Giữ preset, `fit/cover/pad`, không tự phóng to, auto-orient EXIF, lựa chọn điểm crop, batch rename, UI trước/sau, cache, `run/check/dry-run`, `init`, `resize`, báo cáo.
- Không thêm framework full-stack, authentication service hay cloud storage vào MVP.

### 0.2. Không làm ở v1

- HTTP API công khai cho server-to-server (`imgfit ui` chỉ phục vụ người dùng local), SDK riêng cho từng ngôn ngữ.
- PDF/OCR, video, GIF động, input SVG, PSD/RAW, HEIC nếu platform/codec không được xác minh, URL download từ internet, AI face detection, cloud sync.
- Không tự thêm hỗ trợ PDF vào image pipeline: nếu sau này cần, phát triển adapter `pdf-render` riêng; PDF có text thì ưu tiên đọc text trực tiếp.
- Không hứa ảnh nén sẽ giống pixel-for-pixel với imgproxy dù cùng dùng libvips (phiên bản thư viện, preset và encoder có thể khác nhau).
- Không mặc định chuyển định dạng sang JPG khi `format: keep` gặp định dạng không hỗ trợ: báo lỗi rõ ràng hoặc dùng fallback được cấu hình tường minh.

### 0.3. Tiêu chí thành công

1. Workload tham chiếu (§1) được xử lý đúng preset; không mất file nguồn, không trùng output; thay nội dung cùng đường dẫn không đụng file phụ của framework (vd. Unity `.meta`/GUID).
2. `imgfit run` chạy lại cho đầu ra không đổi → không encode lại; sửa nguồn/preset/focal point → tái xử lý đúng; xóa/hỏng output → không skip sai.
3. `imgfit check` chạy read-only, mã thoát đáng tin cậy cho pre-commit/CI.
4. Batch có lỗi không làm hỏng ảnh đã ghi thành công; lỗi được tổng hợp và có exit code khác 0; có khả năng tiếp tục sau khi khởi động lại.
5. Web UI chỉ cho phép duyệt/ghi trong root được cấp quyền; không bị website khác điều khiển API local; file preview/temp được dọn.
6. Cài package và chạy trên Windows (PowerShell), Ubuntu/WSL; test smoke với macOS nếu có máy/CI.
7. Chất lượng crop, alpha và màu được đánh giá trên bộ ảnh vàng (golden fixtures), **không chỉ dựa vào tốc độ**.
8. Có ví dụ tích hợp chạy trong CI cho Node, Python, PHP/Laravel và shell, **chỉ dùng CLI + JSON**, không cần biết nội bộ Node.
9. Máy không cài Node vẫn dùng được qua binary độc lập hoặc Docker image (§6.3).
10. Áp imgfit vào dự án đã có sẵn ảnh output không bị lỗi conflict hàng loạt (luồng `--adopt`).

---

## 1. Workload tham chiếu (dùng cho benchmark và fixture)

Các nhóm ảnh điển hình mà mọi loại dự án (web, mobile, game, tài liệu) đều gặp. Đây là **bộ benchmark chung**, không phải phạm vi của một dự án cụ thể; fixture được tự tạo hoặc có license phù hợp.

| Nhóm ảnh | Workload benchmark | Kích thước đích ví dụ |
|---|---|---|
| Ảnh lớn có alpha (banner, sprite, illustration) | 10 PNG, mỗi file 8–9 MB | `fit` tối đa 1024 px |
| Ảnh nền toàn màn hình / hero image | vài JPG 0.3–5 MB | `fit` 1920×1080 hoặc 2048 px |
| Icon / logo nhỏ | PNG 10–50 KB/file | `fit` 256 px, giữ alpha |
| Avatar / thumbnail hàng loạt | 200 ảnh JPG/PNG, nguồn 1–3 MB/ảnh | `cover` 256×256, JPG/WebP |

Số liệu dung lượng sau tối ưu chỉ được công bố sau benchmark trên fixture thực, không ước lượng trước. Với ảnh có alpha hoặc chữ mảnh, so sánh PNG palette với PNG truecolor bằng mắt trước khi đổi mặc định.

---

## 2. Hợp đồng chức năng

### 2.1. CLI ổn định

```bash
imgfit --version [--json]              # kèm version sharp/libvips khi --json
imgfit init --profile web              # profile: generic | web | unity (chỉ là bộ mặc định)
imgfit run --config imgfit.json        # áp rules, incremental mặc định
imgfit run --dry-run                   # liệt kê candidate; không ghi file/cache
imgfit run --adopt                     # nhận output có sẵn ở đúng đích rule vào diện quản lý; không encode
imgfit run --jobs 4                    # điều chỉnh song song
imgfit check --config imgfit.json      # read-only, chuẩn cho CI
imgfit resize "raw/**/*.{jpg,png}" --size 256x256 --mode cover --format jpg --output out/
imgfit resize raw/ --preset thumb --config imgfit.json --recursive
imgfit exec --stdin                    # nhận job JSON từ stdin, trả NDJSON — cho tích hợp từ ngôn ngữ khác
imgfit info photo.jpg --json           # metadata/kích thước/alpha/orientation, không ghi gì
imgfit capabilities --json             # format/codec bản build hiện tại hỗ trợ
imgfit schema config|result|job        # in JSON Schema để ngôn ngữ khác sinh type/validate
imgfit ui --root . --port 8765
imgfit run --json                      # stdout chỉ chứa JSON; log/progress ghi stderr
```

**Chuẩn hành vi chung:**

- Thứ tự ưu tiên tham số: **CLI > biến môi trường `IMGFIT_*` > `imgfit.json` > mặc định của profile > mặc định tool**. Lệnh `--dry-run --json` in ra cấu hình hiệu lực cuối cùng để debug.

- CLI mặc định resolve đường dẫn tương đối theo **thư mục chứa `imgfit.json`**; lệnh `resize` không dùng config resolve theo working directory. Nêu rõ trong `--help`.
- `--dry-run`: không tạo output, không ghi cache/crop, không xóa bất kỳ file nào. Kích thước file sau encode nếu chưa thực thi phải hiển thị **`unknown`** (output người đọc) / **`null`** (JSON, để giữ kiểu số cho ngôn ngữ có type), không được khẳng định trước.
- `--skip-existing`: nếu bật, chỉ skip khi output tồn tại; **không thay** logic incremental an toàn của `run` và phải cảnh báo rằng option này không xác thực output.
- `--overwrite` hoặc `onConflict=replace` cho phép thay output có chủ đích. Mặc định `onConflict=error` chỉ áp cho **file lạ** — file không do imgfit quản lý. Output được coi là *đã quản lý* khi nằm đúng đích một rule sinh ra **và** có trong `imgfit.managed.json` (commit được, §4.4). Không dựa vào cache, vì cache có thể bị xóa hoặc không có trên máy khác. `run` được thay output đã quản lý khi fingerprint cho thấy cần làm mới.
- `--adopt`: dùng khi áp imgfit lần đầu vào dự án đã có ảnh. Liệt kê các file nằm đúng đích rule, cần xác nhận (hoặc `--yes` trong CI), rồi ghi vào `imgfit.managed.json`; không encode, không sửa ảnh. File nằm ngoài đích rule không bao giờ được adopt.
- `--backup` khi ghi đè: backup vào `.imgfit/backups/` ở root dự án (cùng ổ đĩa, gitignored), **không đặt cạnh output**; chỉ giữ/cleanup theo chính sách; không tự xóa backup có giá trị.
- `--json`: stdout là **một document JSON** (`exec`/`--json-lines`: NDJSON, mỗi dòng một event). Cấu trúc tối thiểu: `schemaVersion`, `command`, `status`, `summary{total, processed, skipped, failed, bytesSaved}`, `files[]` (file, rule, preset, destination, status, inputBytes, outputBytes, inputPx, outputPx, elapsedMs, warnings, errors, fingerprint), `errors[]`. Schema công bố qua `imgfit schema result`; thay đổi phá vỡ chỉ khi tăng `schemaVersion`.
- Mỗi lỗi/cảnh báo có `code` ổn định (`E_CONFIG_INVALID`, `E_OUTPUT_CONFLICT`, `E_SMALL_INPUT`, `W_ALPHA_FLATTENED`…) để code ở ngôn ngữ khác xử lý mà không phải parse message.
- `--quiet`, `--verbose` tùy chọn; không trộn progress bar vào JSON.

**Exit code:** `0` tất cả hợp lệ/thành công; `1` có ít nhất một xử lý hoặc check thất bại; `2` lỗi tham số/cấu hình; `3` lỗi truy cập/permission hoặc lỗi môi trường khiến lệnh không khởi động; `130` bị hủy bằng Ctrl+C (có thể theo convention của shell/platform). Các mã cụ thể phải được test xuyên nền tảng; JSON luôn báo lỗi chi tiết.

### 2.2. Định nghĩa chế độ resize

| Tên imgfit | Sharp                                      | Hành vi                                         |
| ---------- | ------------------------------------------ | ----------------------------------------------- |
| `fit`      | `resize({fit:'inside'})`                   | Vừa khung, giữ tỷ lệ, có thể không đạt đúng W×H |
| `cover`    | `resize({fit:'cover'})` hoặc crop thủ công | Kín khung W×H, cắt bớt biên, giữ tỷ lệ          |
| `pad`      | `resize({fit:'contain',background})`       | Đúng W×H, đệm nền (cần xác định alpha cho JPG)  |

- `upscale: false` mặc định. **Đối với `cover`/`pad` cần chỉ rõ chính sách nếu ảnh gốc bé hơn target**: không thể đồng thời đảm bảo `exact W×H` và `no upscale` trong mọi trường hợp. Mặc định `smallInput: error` cho asset yêu cầu kích thước chính xác, `smallInput: keep` chỉ cho `fit`; hỗ trợ `smallInput: pad` nếu người dùng chấp nhận thêm nền.
- `orientation`: tự động theo EXIF trước khi tính khung crop; kiểm thử đủ orientation (gồm mirrored).
- `smallInput` mặc định theo mode: `fit` → `keep`, `cover`/`pad` → `error`; preset ghi đè được.
- `crop.position` (khóa `crop: {position}` trong preset): `center | top | attention | focal`. `attention` là heuristic độ nổi bật, **không phải nhận diện mặt**.
- `focalPoint: {x, y}` là tọa độ chuẩn hóa `[0,1]` trong **ảnh đã auto-orient**. Với crop thủ công: tính hình chữ nhật nguồn đúng tỷ lệ target, giữ focal point trong khung khi có thể, clamp trong biên, `extract()` rồi `resize()`. Không truyền `{x,y}` trực tiếp vào `sharp.resize().position`.
- `sharpen`: để `false` mặc định; khi bật dùng sigma/params hợp lệ của Sharp, không dùng thang `0..100` như đã ghi trong plan cũ vì không ánh xạ trực tiếp. Chỉ sharpen sau khi giảm cỡ; test tránh halo.
- `blockMultiple` (thường bật qua profile `unity`): tùy chọn 4 cho texture cần BC/DXT; **không cưỡng ép mọi ảnh** vào bội số 4, không ngầm thay kích thước preset. Nếu cần làm tròn, quy định `round=down` và báo kích thước thực trước khi ghi.
- `format: keep | jpg | png | webp | avif`; whitelist format theo `profile`. `keep` chỉ cho định dạng được hỗ trợ tường minh; output extension luôn đúng với bytes thực.
- Ảnh alpha → JPG phải có `background` được khai báo (mặc định trắng `#ffffff` nếu profile cho phép), báo warning nếu mất transparency; input là GIF/APNG đa khung phải từ chối trong v1 (không âm thầm chọn frame đầu).
- `stripMetadata=true` mặc định, chuyển sRGB có chủ đích; xuất metadata rõ ràng, không hứa mọi trường hợp màu hoàn toàn bất biến. `icc`/màu đặc biệt cần fixture.

---

## 3. Cấu hình dự án — chuẩn hóa, dễ chia sẻ

**Ví dụ `imgfit.json` (dự án web bất kỳ — Laravel, Django, Next…):**

```json
{
  "$schema": "./imgfit.schema.json",
  "schemaVersion": 1,
  "profile": "web",
  "env": ["IMG_SOURCE_DIR"],
  "roots": {
    "input": "${IMG_SOURCE_DIR}",
    "output": "."
  },
  "defaults": {
    "upscale": false,
    "stripMetadata": true,
    "onConflict": "error",
    "jobs": 4
  },
  "presets": {
    "hero": { "size": [1920, 1080], "mode": "fit", "format": "jpg", "quality": 85 },
    "thumb": {
      "size": [256, 256],
      "mode": "cover",
      "crop": { "position": "attention" },
      "format": "webp",
      "quality": 82,
      "background": "#ffffff"
    },
    "logo": { "size": [256, 256], "mode": "fit", "format": "png" }
  },
  "rules": [
    {
      "id": "products",
      "from": "products/**/*.{jpg,jpeg,png,webp}",
      "preset": "thumb",
      "to": "public/images/products/{dir}/{name}.{ext}"
    },
    {
      "id": "avatars",
      "from": "avatars/*.{jpg,jpeg,png}",
      "preset": "thumb",
      "names": "imgfit.names.json",
      "to": "public/images/avatars/{id}.{ext}"
    }
  ],
  "budget": { "maxFileKB": 1024 },
  "cache": { "path": ".imgfit/cache.json" },
  "cropOverrides": { "path": "imgfit.crops.json" }
}
```

Ví dụ cho dự án Unity xem Phụ lục A. **Profile** chỉ là bộ mặc định + whitelist format: `generic` (jpg/png/webp), `web` (thêm avif), `unity` (không webp/avif, gợi ý `blockMultiple`). Core không có nhánh code riêng theo framework.

**Placeholder hợp lệ trong `to`** (whitelist, schema kiểm tra):

| Placeholder | Giá trị |
|---|---|
| `{name}` | basename nguồn không đuôi, đã sanitize |
| `{ext}` | đuôi theo **format output thực** (`jpg`, `png`, `webp`, `avif`) |
| `{id}` | ID tra từ file `names` của rule; thiếu/trùng → lỗi preflight |
| `{preset}` | tên preset (dùng khi một input sinh nhiều preset) |
| `{w}`, `{h}` | kích thước target của preset |
| `{dir}` | thư mục con tương đối theo phần glob; **ngoại lệ duy nhất** được chứa `/`, từng segment được sanitize, không có `..` |

**Quy tắc chuẩn:**

1. `${VAR}` chỉ được expand khi tên biến nằm trong `env` của config; biến thiếu → báo lỗi. Không thực thi shell hoặc đánh giá code từ config. Hướng dẫn Windows PowerShell, WSL/Linux cách set biến.
2. Root output nằm trong dự án; giải quyết `..`, absolute paths, symlink/realpath **trước mỗi lần truy cập nhạy cảm**, không chỉ kiểm tra prefix chuỗi. Nếu root output chưa tồn tại, kiểm tra parent realpath an toàn trước khi tạo.
3. JSON Schema `additionalProperties: false` tại các object chính, versioned `schemaVersion`, kiểm tra kiểu, bounds, enum, tên preset tồn tại, `rule.id` duy nhất, template placeholder nằm trong whitelist.
4. `to` không được chứa placeholder sinh ra separator/path traversal; `{name}` được sanitize như basename; quy định rename collision, chữ hoa/thường trên Windows, Unicode normalization, reserved filenames (`CON`, `NUL`, v.v.).
5. **Preflight tạo manifest đầu ra cho toàn bộ batch**, phát hiện hai input/rule cùng destination, source=destination, path ngoài root, extension không khớp format. Có collision → dừng batch trước khi ghi.
6. Một input có thể sinh nhiều preset: `"preset": ["L", "LL"]` và template `{preset}/{name}.{ext}` hoặc `{name}-{preset}.{ext}`. Chính sách khi input nhỏ hơn preset phải được định nghĩa riêng, không suy diễn.
7. `imgfit init` tạo schema local tương ứng với version package; không tự ghi đè config/schema hiện hữu nếu không có `--force`.
8. Cấu hình mẫu không phụ thuộc máy `D:`; chỉ ví dụ env var. Commit được: `imgfit.json`, `imgfit.crops.json`, `imgfit.names.json`, `imgfit.managed.json`. Luôn gitignore: thư mục `.imgfit/` (cache, backup, lock, temp). `imgfit init` thêm dòng tương ứng vào `.gitignore` nếu chưa có.

**Tương thích hệ thống resize có sẵn (imgproxy, Thumbor…):** có thể khai báo preset cùng kích thước/quality (vd. `L=640×480`, `LL=1600×1200`, quality 80, không upscale), nhưng chỉ khẳng định **tương thích quy tắc kích thước**, không cam kết byte giống. Cần golden test nếu yêu cầu gần giống production.

---

## 4. Kiến trúc và hợp đồng module

```text
imgfit/
├── package.json              # exports, bin, engines, files, build/package scripts
├── package-lock.json         # lock dependencies
├── tsconfig.json
├── src/
│   ├── index.ts              # Node API công khai: run(), check(), resize(), info() — dùng chung core với CLI
│   ├── cli.ts                # commander, validation, exit codes
│   ├── commands/             # run, adopt, check, resize, exec, info, capabilities, schema, init, ui
│   ├── core/
│   │   ├── process.ts        # pure transformation options -> image
│   │   ├── crop.ts           # focal geometry, EXIF normalized coords
│   │   ├── batch.ts          # bounded concurrency, cancellation, summary
│   │   ├── planner.ts        # deterministic manifest + collision check
│   │   ├── output.ts         # safe staging + replace/backup
│   │   ├── fingerprint.ts    # hashes and output verification
│   │   ├── managed.ts        # imgfit.managed.json: output nào do imgfit quản lý
│   │   ├── lock.ts           # lockfile trong .imgfit/locks
│   │   ├── report.ts         # JSON/NDJSON result theo schema
│   │   ├── formats.ts        # MIME/format allowlist
│   │   └── errors.ts         # structured error codes
│   ├── config/
│   │   ├── schema.ts         # versioned Ajv
│   │   ├── load.ts
│   │   └── resolve.ts        # paths, templates, glob
│   ├── server/
│   │   ├── app.ts            # loopback + token/origin checks
│   │   ├── sessions.ts       # temp directories lifecycle
│   │   └── routes/           # presets, uploads, batches, SSE, previews, zip, write
│   └── contracts/            # result, config and API types
├── ui/                        # Vue 3/Vite TS; builds into dist/ui
├── schema/                    # imgfit.schema.json, result.schema.json, job.schema.json
├── examples/                  # node, python, php-laravel, shell, unity, docker — chạy trong CI
├── fixtures/                  # deterministic small test images
├── test/{unit,integration,e2e}/
└── scripts/                   # build, smoke-package, bench
```

### 4.1. Quy trình lệnh `run`

```text
Load config → validate schema/semantic → resolve roots and source matches
→ detect image content + metadata limits → expand presets
→ build stable manifest & detect collisions → compare fingerprint + output
→ process with bounded concurrency → write temporary in destination directory
→ validate produced image → safe replace / backup → update cache atomically
→ aggregate report + exit code
```

**Processing per file:** validate file signature/codec → apply EXIF orientation → compute crop geometry → resize/pad → optional sharpen → color conversion → alpha flatten if required → output encoder → validate size/type → safe output. Image transform cannot be assumed to support every source format; check Sharp build/platform capabilities.

### 4.2. Batch + cancellation

- Hàng đợi trong RAM bằng `p-limit`; mặc định **4 jobs**, không phụ thuộc trực tiếp CPU. Thêm giới hạn `--jobs 1..N` và budget RAM thực tế, ví dụ không nhận batch tạo quá nhiều decoded pixels một lúc.
- Không tự ép `sharp.concurrency(1)` và `sharp.cache(false)` cho mọi máy. Benchmark rồi mới chỉnh; `UV_THREADPOOL_SIZE` nên đặt trong environment **trước khi process Node chạy**, không coi việc gán trong `cli.ts` là bảo đảm.
- Cancel: không bắt đầu task mới, task đang chạy hoàn thành hoặc dừng nếu API hỗ trợ; không tự rollback ảnh đã commit thành công. Ghi `status=cancelled/partial` minh bạch.
- Event progress: `queued`, `processing`, `done`, `skipped`, `failed`, `cancelled`; có `jobId`, `completed`, `total`, `bytesSaved`. Không tạo một promise/Buffer toàn bộ ảnh lớn trong RAM.
- Report ghi ra file khi được yêu cầu (`--report-json path`); log lỗi không chứa token hoặc full path nhạy cảm trong UI mặc định.

### 4.3. Ghi file an toàn

- **Mọi output phải đi qua preflight** kiểm tra quyền, trùng tên, path traversal, symlink, tương quan source/destination.
- Encode ra file tạm **trong thư mục đích** (`.<name>.imgfit-<unique>.tmp`) rồi kiểm tra metadata/file size trước khi publish.
- Trường hợp output chưa tồn tại: dùng phép tạo/move có cơ chế không thay file hiện hữu để chống race; xử lý `EEXIST` thành conflict. Trường hợp replace: backup nếu bật, thay output bằng thao tác rename thích hợp trên từng OS, **không khẳng định atomic replace xuyên nền tảng**.
- Nếu replace thất bại, cố giữ bản cũ; rollback/restore backup khi có thể. Không xóa ảnh gốc. Dọn file tmp theo session/job, kể cả crash cũ ở lần chạy sau khi được xác minh an toàn.
- Ghi nội dung ảnh vào cùng đường dẫn giữ nguyên file phụ của framework (Unity `.meta`/GUID…) **nếu tool không đụng các file đó**; test trên bản copy project và kiểm tra GUID thật.
- Không ghi cùng file từ hai process đồng thời: lockfile trong `.imgfit/locks/` có TTL/owner, báo conflict; xử lý stale lock cẩn thận.
- Backup và lock **không bao giờ đặt cạnh output**: Unity sẽ import `x.png.bak` thành asset, web server có thể public file đó. File tạm trong thư mục đích dùng tiền tố `.` và đuôi `.tmp` để các công cụ watch/import (Unity, Vite, webpack…) bỏ qua.
- Windows: rename/replace có thể gặp `EBUSY`/`EPERM` khi editor, IDE hoặc antivirus đang giữ file → retry có backoff giới hạn, sau đó báo lỗi rõ và giữ nguyên bản cũ.

### 4.4. Cache, fingerprint và dữ liệu crop

**Tách theo vai trò:**

- `.imgfit/cache.json` — _có thể xóa_, gitignored. Lưu output path, input hash, normalized preset hash, fingerprint pipeline/engine version, output signature (bytes/hash hoặc mtime+size theo mức tin cậy) và trạng thái thành công. **Chỉ dùng để skip**, không dùng để quyết định conflict.
- `imgfit.managed.json` — commit được. Danh sách output do imgfit quản lý: đường dẫn tương đối, rule id, hash output lần ghi cuối. Dùng cho `onConflict` và `--adopt`; nếu hash output hiện tại khác hash đã ghi (có người sửa tay) → cảnh báo, cần `--overwrite`.
- `imgfit.crops.json` — _dữ liệu người dùng_, commit được. Lưu stable ID/relative source path + normalized focal point + orientation convention. Khi sửa ảnh hoặc crop khác, fingerprint phải đổi.
- `imgfit.names.json` — _dữ liệu người dùng_, commit được. Mapping relative source path → `id` cho placeholder `{id}`. Do UI `RenameMapper` hoặc người dùng/script ở bất kỳ ngôn ngữ nào sinh ra; nhờ vậy `run`/`check` từ CLI tái tạo đúng tên file như trên UI.

Cache key đề xuất:

```text
SHA256(source bytes || effective preset (sau khi gộp defaults + profile) + encode options
       || focalPoint || pipelineVersion || sharp version || libvips version
       || effective output format)
```

Skip chỉ khi manifest trùng, output tồn tại, loại file/metadata hợp lệ, và output signature khớp chính sách. Nếu output bị xóa/sửa thì reprocess; cache bị lỗi định dạng thì rebuild thay vì bỏ sót. Ghi cache qua temp+replace; **chỉ mark success sau khi output đã publish**.

Với batch lớn, có thể tối ưu lại bước hash sau khi correctness đã qua test. Không cam kết `run` lần hai <1 giây nếu vẫn hash hàng trăm MB; đo rõ cached filesystem vs cold filesystem và dùng mốc tham khảo, không dùng làm gate cứng.

---

## 5. Web UI: trải nghiệm + an toàn máy local

### 5.1. User flows

1. **Quick resize:** drag/drop file/folder → preset/custom size → preview trước/sau → tải ảnh hoặc ZIP.
2. **Project mode:** `imgfit ui --root /path/to/project` → đọc `imgfit.json` → xem manifest → chọn/preview → bấm Process → xác nhận ghi vào project.
3. **Rename/ID mode:** chọn preset (vd. `thumb`), xác nhận crop cho ảnh bị lệch → dán danh sách ID → kiểm tra tên trùng/thiếu/dư → xem trước toàn bộ mapping → lưu vào `imgfit.names.json` → xuất `{id}.{ext}`.
4. Batch lớn: SSE hiển thị progress từng ảnh + tổng, cancel, retry failures; không upload lại ảnh nếu backend giữ session temp.
5. Không dồn hàng trăm ảnh thành hàng trăm preview gốc full-resolution; thumbnail lazily loaded, chỉ load ảnh selected.

### 5.2. Backend API phiên bản 1

| Endpoint                            | Mục đích                                    |
| ----------------------------------- | ------------------------------------------- |
| `GET /api/v1/health`                | phiên bản + trạng thái không nhạy cảm       |
| `GET /api/v1/presets`               | preset đã validate                          |
| `POST /api/v1/sessions`             | tạo session temp                            |
| `POST /api/v1/sessions/:id/uploads` | upload theo batch, giới hạn size/count      |
| `POST /api/v1/batches`              | tạo job xử lý từ session hoặc root cho phép |
| `GET /api/v1/batches/:id`           | trạng thái + summary                        |
| `GET /api/v1/batches/:id/events`    | SSE progress, reconnect bằng event id       |
| `POST /api/v1/batches/:id/cancel`   | yêu cầu hủy                                 |
| `GET /api/v1/previews/:id`          | thumbnail / output preview                  |
| `GET /api/v1/batches/:id/archive`   | ZIP, stream không gom RAM                   |
| `POST /api/v1/write/preview`        | manifest file thay thế, **không ghi**       |
| `POST /api/v1/write/commit`         | ghi sau xác nhận + revalidate manifest      |

Không triển khai `GET /api/fs?path=<arbitrary>` vô giới hạn. Nếu cho duyệt thư mục, chỉ trả nội dung bên trong root được cấp quyền; root được chọn từ CLI hoặc local-only UX có xác nhận. Không có API nhập bất kỳ absolute path rồi tùy ý đọc/ghi ổ đĩa.

### 5.3. Security baseline không được bỏ

- Listen duy nhất `127.0.0.1` theo mặc định; **không bật `0.0.0.0` trong v1**.
- Browser UI cùng origin với API khi build; validate `Host`/`Origin`, CORS tắt theo mặc định, reject cross-site writes; dùng session token khó đoán hoặc CSRF token (gắn với phiên), SameSite cookie nếu dùng cookie. Token bootstrap không được lưu vào log. Có thể áp `Sec-Fetch-Site` như lớp phụ, không phải lớp duy nhất.
- `EventSource` (SSE) và `<img>` preview không gửi được header tùy biến → bootstrap token chỉ nằm trong URL mở UI **một lần**, đổi ngay sang cookie phiên `HttpOnly; SameSite=Strict` rồi xóa khỏi URL. Không để token dùng lâu dài trong query string.
- Phòng DNS rebinding/localhost request forgery: allowlist `Host` (`127.0.0.1`, `localhost` theo chính sách), kiểm tra origin cho state-changing endpoints, xác thực token cho read/write nhạy cảm.
- `multer` giới hạn **50 MB/file**, số file, tổng bytes/session và tổng jobs; validate image magic bytes với Sharp, giới hạn `limitInputPixels`, thời gian xử lý/định dạng (best effort), không tin tên/MIME upload.
- Chống zip slip: tên entry ZIP từ manifest đã sanitize; không zip file ngoài root/session.
- Symlink/junction: deny hoặc resolve + verify; ngăn TOCTOU bằng cách hạn chế root và kiểm tra lại ngay trước thao tác, ghi nhận rằng Node có giới hạn bảo đảm tuyệt đối trước race.
- Không chạy shell command từ tên file, không fetch URL, không giải nén archive upload trong v1.
- Thư mục temp riêng theo session (`0700` khi hỗ trợ), cleanup trên kết thúc/TTL/startup; giới hạn disk usage, reject khi ổ đĩa không đủ.
- `write/commit` yêu cầu **review danh sách ghi đè**, có confirmation nonce ngắn hạn gắn với manifest hash; nếu file thay đổi từ preview → buộc review lại.
- Chạy scan `npm audit` (có phân loại độ nghiêm trọng) và test security cho API trước release.

### 5.4. UI components

`DropZone`, `SourceList`, `PresetForm`, `CropEditor`, `CompareSlider`, `RenameMapper`, `BatchProgress`, `ConflictReview`, `ResultTable`, `ErrorSummary`. Composable `useSession`, `useBatch`, `usePresets`; không cần Pinia hoặc Vue Router ở phiên bản một màn hình.

**UX quan trọng:** thanh so sánh trước/sau cùng khung và cùng zoom; tọa độ click tính đúng khi ảnh dùng `object-fit:contain`; EXIF auto-orient trên cả preview và output; rõ ràng khi crop làm mất phần ảnh. Rename không tự fuzzy-match nếu mơ hồ: yêu cầu xác nhận mapping trước khi write.

---

## 6. `check`, CI và hợp đồng tích hợp

### 6.1. Chính sách `check` chính xác

`imgfit check` là **read-only**: kiểm tra các file thuộc _output rules_, không sửa/encode ảnh.

- Kiểm tra file tồn tại, dimensions theo preset (`fit` là tối đa, `cover/pad` phải exact nếu policy yêu cầu), định dạng/magic bytes và extension, budget KB, alpha policy, format profile Unity/Web, tên file theo template.
- Nếu có cache hợp lệ, kiểm tra fingerprint để đánh dấu `stale` khi nguồn hoặc preset đổi. Nếu thiếu nguồn (ví dụ CI chỉ có repository output), hỗ trợ `--check-mode output-only` và ghi rõ đây là validation giới hạn, **không chứng minh đúng crop**.
- Không thể biết pixel output đúng tuyệt đối từ kích thước/file size; nếu cần xác minh nghiêm ngặt thì `--check-mode reproducible` so sánh checksum kết quả tái tạo ở môi trường pin version (tốn CPU, ghi chỉ vào temp, không chạm project).
- Trả JSON có `pass|warn|fail`, reason code, file; `--strict` biến warning thành thất bại khi cần.

**CI:** có `npm run images:check` và example GitHub Actions chạy `output-only`; job `reproducible` riêng nếu nguồn ảnh có sẵn. Pre-commit chỉ nên check file liên quan/staged path; phải đảm bảo không bỏ sót rule bị thay đổi trong config (lúc đó full check).

### 6.2. Hợp đồng tích hợp đa ngôn ngữ

**CLI là API chính.** Mọi ngôn ngữ dùng chung một hợp đồng:

| Thành phần | Hợp đồng |
|---|---|
| Cách gọi | Tiến trình con với **mảng argv**, không qua shell — tránh lỗi quoting/injection, nhất là trên Windows |
| Input phức tạp | `--config path`, hoặc `imgfit exec --stdin` nhận job JSON: `{"schemaVersion":1,"jobs":[{"input":"a.jpg","preset":"thumb","output":"out/a.webp"}]}` (preset lấy từ `--config` hoặc khai báo inline) |
| Output | `--json`: một document; `exec`/`--json-lines`: NDJSON, mỗi dòng một event `progress` / `result` / `summary` |
| Lỗi | Exit code (§2.1) + `errors[].code` ổn định |
| Log | Luôn ở stderr; stdout sạch khi bật `--json` |
| Schema | `imgfit schema config\|result\|job` → sinh type bằng quicktype, datamodel-code-generator… |
| Encoding/path | UTF-8; path trong JSON dùng `/`, tương đối theo root config, trừ khi có `--absolute-paths` |
| Tìm binary | `IMGFIT_BIN` nếu có, nếu không thì `imgfit` trên `PATH` |

Node có thêm API import trực tiếp (`import { run } from "imgfit"`), dùng chung core và type với CLI. Ngôn ngữ khác **không cần SDK** ở v1; nếu sau này làm SDK mỏng (vd. `imgfit-py`) thì chỉ bọc CLI, không viết lại logic.

### 6.3. Phân phối

| Kênh | Dành cho | Ghi chú |
|---|---|---|
| npm: `npm i -D imgfit`, `npx imgfit@x.y.z` | Dự án đã có Node (Node, Laravel + Vite, Vue…) | Private registry hoặc Git URL **pin tag/commit** |
| Binary độc lập theo platform (win-x64, linux-x64, linux-arm64, macos-arm64) | Python, PHP, Unity, CI không có Node | Node SEA hoặc công cụ tương đương + binary native của sharp/libvips đi kèm. **Cần PoC ở Đợt 1**, vì đóng gói native addon chưa chắc chắn |
| Docker image `imgfit:<version>` | CI, hoặc máy không muốn cài gì | Mount thư mục project; chú ý uid/quyền file trên Linux |

Mọi kênh dùng cùng một semver. `imgfit --version --json` báo cả version sharp/libvips. Dự án nên pin version (lockfile npm, file `.imgfit-version`, hoặc tag Docker); CLI cảnh báo khi version đang chạy khác `.imgfit-version`.

**Package npm:** build `dist/cli.js`, `dist/ui`, schema trước khi đóng gói; `npm pack` + install smoke test từ `.tgz` trên project trống. Không phụ thuộc `prepare` bắt consumer build source/UI mỗi lần cài từ Git. Trường hợp Git install, dùng tag/commit pin và kiểm chứng lifecycle scripts/trust nguồn vì install scripts có quyền trên máy. Chỉ đưa file cần thiết vào `files` của package, không đóng gói fixture/source thừa. CLI `bin` phải có shebang Node và chạy được cross-platform.

### 6.4. Ví dụ tích hợp (đặt trong `examples/`, chạy trong CI)

**Node**

```ts
import { run } from "imgfit";
const report = await run({ config: "imgfit.json" });
if (report.summary.failed > 0) process.exitCode = 1;
```

**Python**

```python
import json, os, subprocess
bin = os.environ.get("IMGFIT_BIN", "imgfit")
r = subprocess.run([bin, "run", "--config", "imgfit.json", "--json"],
                   capture_output=True, text=True, encoding="utf-8")
report = json.loads(r.stdout)
if r.returncode != 0:
    raise SystemExit(f"imgfit failed: {report['summary']}")
```

**PHP / Laravel** (`Process` của Laravel 10+, hoặc `symfony/process`)

```php
use Illuminate\Support\Facades\Process;

$result = Process::run([env('IMGFIT_BIN', 'imgfit'), 'run', '--json']);
$report = json_decode($result->output(), true, flags: JSON_THROW_ON_ERROR);
if ($result->failed()) { throw new RuntimeException('imgfit failed'); }
```

**Shell / Makefile / CI**

```bash
imgfit check --check-mode output-only --json > imgfit-report.json
docker run --rm -v "$PWD:/work" -w /work imgfit:1.0.0 check
```

**Unity:** `Tools/images.ps1` (Windows) / `Tools/images.sh` (WSL/Linux) gọi binary; hoặc menu Editor gọi `System.Diagnostics.Process` theo cùng hợp đồng. Lưu ý đường dẫn mount ổ Windows trong WSL.

---

## 7. Kiểm thử và benchmark: tiêu chí nghiệm thu định lượng

### 7.1. Test matrix bắt buộc

| Nhóm            | Trường hợp                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input           | jpg/png/webp bình thường; file đổi đuôi; file hỏng/truncated; ảnh > max pixels; zero-byte; GIF/APNG động (reject); file không hỗ trợ                                     |
| Orientation/màu | EXIF 1–8 gồm mirrored, alpha PNG→JPG, PNG transparent giữ alpha, ICC/sRGB, text mảnh/logo                                                                                |
| Geometry        | tỷ lệ ngang/dọc/vuông, `fit/cover/pad`, focal ở bốn góc, attention, small input và không upscale, kích cỡ rất nhỏ                                                        |
| Filesystem      | Unicode/space, tên Windows reserved, case collision, cùng đích từ hai rule, symlink, output=source, parent không tồn tại, permission denied, hết disk, cancel giữa chừng |
| Cache           | lần đầu/lần hai, sửa source, sửa preset, sửa focal point, sửa/xóa output, cache corrupt, two-process race                                                                |
| CLI             | dry-run không ghi, JSON parse được, exit code, `check` read-only, Ctrl+C, multiple inputs, Windows/WSL paths                                                             |
| UI/API          | upload size limits, session token, Host/Origin/CORS, path traversal, zip traversal, SSE reconnect, cancel, retry, stale write confirmation                               |
| Framework       | Unity: file ảnh thay mà `.meta` GUID vẫn giữ, backup/lock không sinh asset rác; web: dev server/watcher không bắt file tạm                                                |
| Tích hợp        | ví dụ Node/Python/PHP/shell chạy trong CI; JSON validate theo schema; argv chứa Unicode/khoảng trắng; binary độc lập trên máy không có Node; Docker                   |
| Adopt           | dự án đã có output, cache bị xóa, clone mới trên máy khác → không conflict sai; file sửa tay bị phát hiện                                                                |

- Unit test crop math/planner/config/paths/fingerprint; integration test Sharp với fixtures; API integration test trên loopback; E2E UI ít nhất 1 flow end-to-end (có thể dùng Playwright khi cần).
- Golden fixtures cần ảnh rõ điểm nét/chi tiết để so visual; snapshot image sử dụng mức dung sai phù hợp encoder/version, không so byte mù quáng trừ khi version pin.
- **Không dùng ảnh có bản quyền làm fixture phân phối công khai.**

### 7.2. Benchmark minh bạch

Chạy mỗi case ít nhất 3–5 lần; báo máy/CPU/RAM/OS/Node/Sharp/libvips, job count, định dạng/quality, cold vs warm cache, wall clock, peak RSS, input/output bytes, số lỗi. Test `jobs=1,2,4,8`; định nghĩa tệp ảnh giống nhau cho mọi lượt.

| Workload                | Mục tiêu tham khảo từ plan gốc     | Gate phát hành                                                   |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| 200 JPG 1–3MB → 256×256 | Mong muốn <20 giây trên máy 8 nhân | **Không có lỗi/sai crop/mất dữ liệu**; công bố thời gian đo thực |
| 10 PNG 8–9MB → fit 1024 | Mong muốn <10 giây                 | Ảnh đúng, file hợp lệ, đo peak RAM, chất lượng chấp nhận         |
| Chạy lại không thay đổi | Mong muốn <1 giây                  | Zero re-encode, output không đổi; thời gian được báo thực        |

Tối ưu khi benchmark chỉ ra nút thắt; không bật mặc định `mozjpeg`, `compressionLevel:9`, `png palette`, `sharp.cache(false)` hoặc `sharp.concurrency(1)` nếu chưa đánh giá tradeoff CPU/dung lượng/chất lượng.

---

## 8. Roadmap 6 đợt có tiêu chí Done

### Đợt 1 — Core an toàn + CLI resize (MVP kỹ thuật)

**Xây:** project setup TS/Sharp/Commander/Vitest; validate source; EXIF; fit/cover/pad; encoder; safe staging; preflight conflict; `resize`, `info`, `capabilities`; `--jobs`, `--json` theo `result.schema.json`, error codes, dry-run; benchmark cơ sở; **PoC binary độc lập có sharp** trên Windows + Linux.

**Kết quả (14/11/2026):** đã xong core, `resize`/`info`/`capabilities`/`schema`, 69 test, benchmark cơ sở (README §Hiệu năng), npm pack + cài thử, ví dụ Node/Python/PHP/shell chạy thật. **Chưa làm:** PoC binary độc lập, smoke trên Linux/WSL.

**Done:** xử lý workload tham chiếu (§1), không hỏng file gốc, case collision bị chặn trước ghi; test orientation/alpha/small-input; có benchmark thật 1/2/4/8 jobs (không bắt buộc đạt mục tiêu thời gian); kết luận PoC binary: đạt → dùng, không đạt → fallback Docker.

### Đợt 2 — Config + incremental + check

**Xây:** `schemaVersion`, Ajv, env roots, profiles, presets/rules, placeholder whitelist, manifest, cache SHA256, `imgfit.managed.json` + `--adopt`, `imgfit.names.json`, crop overrides tách riêng, `init`, `run`, `check` output-only, `exec --stdin`, `schema`, `--report-json`.

**Done:** lần chạy thứ hai zero re-encode; thay source/preset/focal/output bắt đúng; xóa cache hoặc clone mới không gây conflict sai; check read-only/exit codes; config mẫu chạy được từ WSL và Windows.

### Đợt 3 — Web UI batch + preview

**Xây:** Express local hardening, upload/session temp, queue shared core, SSE, thumbnail, preview compare, progress/cancel, download zip.

**Done:** kéo/thả 200 ảnh, tiến độ và retry hợp lý, không đơ browser; upload lỗi báo riêng; test Host/Origin/token/traversal; temp tự dọn.

### Đợt 4 — Crop + rename + write project

**Xây:** crop focal editor, crop persistence, ID mapping (ghi `imgfit.names.json`) và collision review, write preview/commit revalidation, replace/backup/lock.

**Done:** ảnh ra đúng `{id}.{ext}`, và `imgfit run` từ CLI tái tạo đúng tên đó; mapping thiếu/trùng báo lỗi trước ghi; giữ nguyên Unity `.meta`/GUID; stale confirmation không thể commit.

### Đợt 5 — Tích hợp, phân phối, CI

**Xây:** npm pack/install smoke, binary độc lập theo platform + Docker image, `examples/` cho Node/Python/PHP-Laravel/shell/Unity chạy trong CI, Unity import test, hooks pre-commit và GitHub Actions check, docs troubleshooting.

**Done:** project trống ở mỗi ngôn ngữ trong `examples/` gọi được imgfit và parse được JSON; máy không có Node chạy được bằng binary hoặc Docker; Windows/WSL smoke pass; CI check không ghi dữ liệu.

### Đợt 6 — Tính năng mở rộng có điều kiện

**Chỉ làm theo nhu cầu:** preset tương thích imgproxy/Thumbor, WebP/AVIF benchmark, `--watch` (debounce + tránh tự trigger output), duplicate detection/report HTML, SDK mỏng cho ngôn ngữ có nhu cầu thật, PDF adapter _repo/module riêng_.

**Done:** mỗi tính năng có use case, test và benchmark; không làm hỏng contract v1.

---

## 9. Rủi ro và cách xử lý

| Rủi ro                           | Mức          | Biện pháp / kiểm chứng                                                                    |
| -------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| Ghi đè nhầm, đích trùng tên      | **Critical** | Manifest preflight, collision reject, write confirmation, temp + backup, integration test |
| API local bị trang web khác gọi  | **Critical** | Host/Origin/CSRF-token validation, loopback only, root allowlist, security tests          |
| Path traversal, symlink/junction | **High**     | Realpath/parent validation, re-check trước I/O, deny unsafe cases                         |
| Crop `attention` sai mặt         | **High**     | Focal manual override, preview, golden visual fixtures                                    |
| RAM cao/batch treo               | **High**     | bounded jobs, pixel/size/count quotas, cancel, benchmark RSS                              |
| Cache bỏ qua file đã sửa         | **High**     | fingerprint source+preset+crop+engine và output signature                                 |
| File phụ framework bị mất (Unity `.meta`/GUID) | **High** | chỉ thay bytes file ảnh, không sửa file phụ, backup/lock ngoài thư mục asset, integration test |
| Hợp đồng JSON/CLI đổi làm vỡ tích hợp ngôn ngữ khác | **High** | `schemaVersion`, error code ổn định, contract test bằng `examples/` |
| Áp vào dự án có sẵn ảnh → conflict hàng loạt | **High** | `imgfit.managed.json` + `--adopt`, test clone mới/xóa cache |
| Đóng gói binary độc lập kèm sharp thất bại | **Medium** | PoC ở Đợt 1, fallback Docker + `npx` |
| Sự khác nhau Windows/WSL/Linux   | **Medium**   | path conventions, env roots, smoke tests, Windows PowerShell script                       |
| Cài package từ Git build lỗi     | **Medium**   | prebuilt distributable + npm pack smoke, lock/pin version                                 |
| PNG alpha kém đẹp sau palette    | **Medium**   | truecolor mặc định, visual QA; palette opt-in                                             |
| Source ảnh có bản quyền          | **Medium**   | nguồn ngoài repo, không phát tán ảnh không có quyền, fixture tự tạo                       |

---

## 10. Checklist release v1.0 (tất cả phải PASS)

- [ ] Core xử lý đúng EXIF, format, transparency, crop, small-input semantics.
- [ ] Plan toàn bộ output trước khi ghi; conflict/path traversal/symlink được test.
- [ ] Ghi ra temp và publish an toàn; lỗi giữa chừng không phá file gốc.
- [ ] Cache và crop overrides tách riêng, re-run không re-encode sai.
- [ ] `dry-run` và `check` hoàn toàn không thay đổi file/cache; exit codes/JSON có test.
- [ ] UI chạy trên loopback, có session-token và Host/Origin protections.
- [ ] Preview trước/sau khớp output; UI có cancel/retry, xác nhận overwrite và cleanup temp.
- [ ] Có test crop manual (focal point), rename collision, Unity `.meta`/GUID.
- [ ] Package cài được từ artifact đã build, smoke trên Windows và Linux/WSL; binary độc lập hoặc Docker chạy được trên máy không có Node.
- [ ] JSON output/config/job có schema công bố; ví dụ Node/Python/PHP/shell pass trong CI.
- [ ] `--adopt` và `imgfit.managed.json` được test với dự án có sẵn ảnh.
- [ ] README có quickstart trong 5 phút, config reference, limitations, FAQ, backup policy.
- [ ] Benchmark công bố số liệu thực trên fixture và phần cứng xác định.
- [ ] Không còn lỗi Critical/High chưa xử lý; không phát hành ảnh có bản quyền trái phép.

---

## 11. Việc phải chốt trước khi code (đề xuất mặc định)

1. **Vị trí ảnh gốc:** khuyến nghị ngoài repo, trỏ qua biến môi trường khai báo trong `env` — _chốt mặc định_.
2. **Nguồn quá nhỏ cho `cover`/`pad`:** `smallInput:error` (không upscale, không giả vờ tạo đúng W×H) — _chốt mặc định_.
3. **Ghi đè:** `resize` báo conflict; project mode yêu cầu preview + confirm; có `--backup` — _chốt mặc định_.
4. **Số jobs:** 4 ban đầu, benchmark trước khi chỉnh — _chốt mặc định_.
5. **JPG mặc định:** quality 85 (preset ghi đè được); alpha flatten nền trắng kèm warning — _chốt mặc định_.
6. **PNG mặc định:** truecolor, compressionLevel 6; palette chỉ opt-in sau khi so chất lượng — _chốt mặc định_.
7. **Repo:** private v1, cấu hình và docs được tách khỏi ảnh nguồn có bản quyền.
8. **Xử lý Git LFS cũ:** không viết lại lịch sử; nếu sau này muốn giảm lịch sử clone phải làm kế hoạch backup/force push riêng.
9. **Giao diện tích hợp:** CLI + JSON là hợp đồng chính; Node API là phụ; không SDK đa ngôn ngữ ở v1 — *chốt mặc định*.
10. **Phân phối cho máy không có Node:** binary độc lập nếu PoC Đợt 1 đạt, nếu không thì Docker image — *chốt sau PoC*.
11. **Dự án có sẵn output:** bắt buộc qua `--adopt` có xác nhận, không tự coi là đã quản lý — *chốt mặc định*.

## Phụ lục A — Ví dụ config cho một dự án Unity bất kỳ

```json
{
  "$schema": "./imgfit.schema.json",
  "schemaVersion": 1,
  "profile": "unity",
  "env": ["IMG_SOURCE_DIR"],
  "roots": { "input": "${IMG_SOURCE_DIR}", "output": "." },
  "defaults": { "upscale": false, "stripMetadata": true, "onConflict": "error", "jobs": 4 },
  "presets": {
    "large-alpha": {
      "size": [1024, 1024], "mode": "fit", "format": "png",
      "png": { "compressionLevel": 6, "palette": false }
    },
    "icon": {
      "size": [256, 256], "mode": "cover", "crop": { "position": "attention" },
      "smallInput": "error", "format": "png"
    }
  },
  "rules": [
    {
      "id": "sprites",
      "from": "sprites/**/*.{png,jpg,jpeg}",
      "preset": "large-alpha",
      "to": "Assets/Art/Sprites/{dir}/{name}.{ext}"
    },
    {
      "id": "icons",
      "from": "icons/*.{png,jpg,jpeg,webp}",
      "preset": "icon",
      "names": "imgfit.names.json",
      "to": "Assets/Art/Icons/{id}.{ext}"
    }
  ],
  "cache": { "path": ".imgfit/cache.json" },
  "cropOverrides": { "path": "imgfit.crops.json" }
}
```

Lần đầu áp vào project đã có ảnh: `imgfit run --adopt` → xác nhận danh sách → các lần `run` sau thay ảnh tại chỗ, giữ `.meta`/GUID.

## 13. Trạng thái triển khai (14/11/2026)

| Đợt | Kết quả | Kiểm chứng |
|---|---|---|
| 1 | `resize`, `info`, `capabilities`, `schema`, engine ghi an toàn | unit + integration test |
| 2 | `imgfit.json` (Ajv 2020-12 + kiểm tra ngữ nghĩa), profile, env allowlist, `run` incremental, `--adopt`, `{id}`/names, crops, `check` (standard / output-only / reproducible, lọc theo path), `init`, `exec` NDJSON, lock, `--report-json` | test project/contract; smoke trên dự án mẫu |
| 3 | Web UI Vue 3 + Express loopback: upload theo phiên, thumbnail, preview trước/sau, SSE + reconnect, hủy, retry, ZIP stream | test API server (bảo mật, upload, SSE, ZIP) |
| 4 | Crop editor, rename mapper, write preview → commit có nonce gắn hash kế hoạch, backup | test API (stale confirmation, nonce dùng một lần) |
| 5 | npm pack smoke, bản portable (Node gốc + app), Dockerfile, CI matrix, ví dụ Node/Python/PHP/shell/hook/CI/Unity | smoke Windows; 105 test pass trong container Linux; Docker image chạy được; portable chạy trên máy không có Node trong PATH |
| 6 | `run --watch`, phát hiện nguồn trùng, `--report-html`, benchmark WebP/AVIF, preset L/LL trong UI | test watch; bench |

**Khác so với plan:**

- **Node SEA một file:** Windows Smart App Control chặn exe chưa ký (inject blob làm hỏng chữ ký `node.exe`). Bản mặc định là portable folder giữ `node.exe` gốc; SEA là tùy chọn `--sea`, cần code-sign trên Windows.
- **ZIP:** không dùng archiver (archiver 8 kéo theo minimatch có lỗ hổng). Thay bằng writer STORE tự viết, không còn dependency có lỗ hổng.
- **TypeScript 5.9** thay vì 7: vue-tsc chưa hỗ trợ TS 7.
- **Ví dụ Go:** bỏ theo yêu cầu.
- **`exec`:** danh sách job dùng khóa `jobs`, mức song song là `concurrency`.

**Chưa làm hoặc chưa kiểm chứng:**

- E2E UI trên trình duyệt thật (Playwright). API đã có test, UI mới được build + type-check.
- Test import trong Unity Editor thật.
- Smoke trên macOS (CI matrix có job macOS nhưng chưa chạy).
- PDF adapter: theo plan là module/repo riêng, không thuộc v1.

## 12. Tài liệu tham khảo kỹ thuật

- Sharp resize/crop: https://sharp.pixelplumbing.com/api-resize/
- Sharp orientation: https://sharp.pixelplumbing.com/api-operation/
- Sharp performance: https://sharp.pixelplumbing.com/performance/
- Sharp install/platform: https://sharp.pixelplumbing.com/install/
- Sharp concurrency/cache: https://sharp.pixelplumbing.com/api-utility/
- OWASP CSRF prevention (API local, token, Origin): https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- DNS rebinding (allowlist Host cho server loopback): tham khảo thêm khi triển khai Đợt 3.
- Node single executable applications (PoC binary độc lập): https://nodejs.org/api/single-executable-applications.html

> **Kết luận:** Kiến trúc ban đầu tốt và được giữ. v2 ưu tiên đúng dữ liệu, tính tái lập, API local an toàn và tiêu chí test rõ ràng. Đây là **bản plan đạt mức sẵn sàng triển khai**, không phải khẳng định phần mềm đã đạt 10/10: chất lượng thực tế chỉ được xác nhận sau khi code, test và benchmark.
