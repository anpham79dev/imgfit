# ImgFit — Kế hoạch định hướng lại và refactor

> **Ngày:** 16/11/2026 · commit gốc `6984117` (`main`)
> **Trạng thái (16/11/2026):** giai đoạn 0–3 và phần README của giai đoạn 6 **đã xong** trên branch `refactor/engine`. Giai đoạn 4 chờ Q1, giai đoạn 5 chờ Q3; mẫu `imgfit.json` của `init` đang dùng giá trị đề xuất, chờ chốt Q2 (mục 5.3).
> Bản plan trước: [docs/archive/plan-v1.md](archive/plan-v1.md).
> **Thay thế** bản plan trước. Bản trước hiểu imgfit là "công cụ quản lý ảnh commit trong repo", và hiểu như vậy là sai.

## 0. Tóm tắt

1. **Mục đích của imgfit:** engine xử lý ảnh dùng chung (resize, chuyển định dạng, watermark). Ứng dụng backend gọi imgfit để chuẩn bị ảnh trước khi upload lên storage (R2/S3). imgfit thay cho code resize tự viết quanh các thư viện như Intervention Image. UI "mở lên resize rồi tải về" chỉ là tính năng phụ.
2. **Lý do:** resize tự viết thường là hộp đen, mỗi nơi một kiểu, và hay mắc các lỗi giống nhau: **phóng to ảnh nhỏ**, **ảnh gần vuông vượt khung**, **watermark méo hoặc bị cắt**, **quality 100 làm file rất nặng** (mục 3). imgfit phải có hành vi rõ ràng, có tài liệu và có test.
3. **Phần engine của imgfit đã hợp mục đích này** và gần như giữ nguyên (~2.900 dòng). Phần **quản lý ảnh trong repo** (~3.500 dòng: `run`/`check`/managed/cache/lock/hook/UI Project…) **không phục vụ mục đích** và sẽ bị bỏ. Đây mới là phần overengineering thật.
4. **Phải thêm:** JPEG progressive, bỏ qua preset khi ảnh nhỏ, giữ định dạng theo whitelist rồi fallback sang JPG, watermark. Để tối ưu dung lượng và số request R2: chọn được WebP/AVIF theo preset, không để ảnh ra nặng hơn ảnh vào, tên file có hash nội dung. Có thể thêm **chế độ service HTTP** (Q1, mục 5).
5. **Ràng buộc chính:** imgfit cần Node ≥ 20.15 và glibc ≥ 2.28, nên không chạy được trên server Linux cũ. Chế độ service giải quyết việc này: bên gọi chỉ cần gửi HTTP, không phải cài Node (mục 4).

## 1. Mục đích, người dùng, tiêu chí thành công

### 1.1. Ai dùng imgfit

| Người dùng | Cách dùng |
|---|---|
| **Ứng dụng backend** (PHP, Go, Python…) | Gọi imgfit trong luồng upload: tạo các bản `L`/`LL`/`O`, gắn watermark, nhận report JSON rồi tự upload |
| **Script batch** | Xử lý lại hàng loạt ảnh bằng `exec` với file job |
| **Dev / người dùng lẻ** | UI Quick: kéo thả ảnh, resize, tải về |

### 1.2. Mục tiêu

1. **Hành vi dễ hiểu và đáng tin.** Mọi quy tắc (khung kích thước, phóng to, crop, nền trong suốt, EXIF, quality, metadata, watermark) được viết ra thành tài liệu, có **bộ ảnh mẫu kiểm chứng**, và report JSON nói rõ đã làm gì với từng ảnh.
2. **Một nguồn logic:** preset và watermark khai báo một lần trong `imgfit.json`, gọi được từ mọi ngôn ngữ.
3. **Chất lượng không thua** các cách phổ biến (Intervention Image, imgproxy) với cùng preset.

### 1.3. Không làm

- Không quản lý ảnh commit trong repo (bỏ `run`/`check`/hook…).
- Không upload lên storage. Bên gọi tự upload.
- Không resize lúc hiển thị (on-the-fly theo URL). Đó là việc của imgproxy hoặc Cloudflare Image Transformations.
- Không hỗ trợ PDF, video, GIF động, HEIC/RAW.

### 1.4. Thất bại dù vẫn "chạy được"

- Ảnh ra **xấu hơn hoặc nặng hơn** Intervention/imgproxy với cùng preset.
- Bên gọi **bắt buộc phải cài Node** mới dùng được.
- Hành vi lại thành hộp đen: thiếu tài liệu, hoặc report không giải thích được vì sao ảnh ra như vậy.

### 1.5. Tiêu chí thành công

1. Bảng hành vi (mục 3.2) được viết thành `docs/behavior.md`, mỗi dòng có test bằng ảnh mẫu.
2. Trên bộ ảnh mẫu, ảnh ra của imgfit không tệ hơn Intervention và imgproxy về kích thước, dung lượng và chất lượng mắt thường.
3. Có số đo độ trễ mỗi lần xử lý: CLI, service, và imgproxy.

## 2. Hiện trạng imgfit

| Khu vực | Dòng | Số phận |
|---|---:|---|
| `src/image` (plan, geometry, encode, probe, formats, options) | 651 | **Giữ**, thêm tính năng |
| `src/pipeline` (job, batch) | 312 | **Giữ** |
| `src/io` (ghi atomic, publish, inputs, zip) | 334 | **Giữ** (`zip` dùng cho UI Quick) |
| `src/core` (errors, exit, report, paths, template, fingerprint, report-html) | 616 | **Giữ**, bỏ `report-html` |
| `src/commands`: `resize`, `exec`, `info` | ~340 | **Giữ**: lõi tích hợp |
| `src/commands`: `run`, `check`, `init`, `watch` | ~580 | **Bỏ** (`init` có thể giữ bản rút gọn, xem 6.1) |
| `src/project` (config rules, manifest, managed, cache, lock, crops, names, decide…) | 1.106 | **Bỏ phần lớn**, chỉ giữ phần đọc file preset |
| `src/cli` | 729 | Giữ, bỏ các lệnh project |
| `src/server` + `ui/src` | 2.855 | Giữ **UI Quick** (phụ), bỏ **UI Project** |
| `test` | 1.397 | Viết lại phần project, thêm test hành vi bằng ảnh mẫu |

Baseline (16/11, Windows 10): `typecheck` pass; `npm test` **104/105** (1 fail do fixture `CON.jpg` không tạo được trên Windows 10, xem phụ lục A). Lưu ý: chạy `vitest` từ PowerShell/cmd, vì từ Git Bash vitest lỗi lúc load.

## 3. Hành vi xử lý ảnh

### 3.1. Lỗi thường gặp của resize tự viết (imgfit phải tránh)

Rút ra từ các cách dùng Intervention Image v2 phổ biến. **Cần chạy ảnh mẫu để xác nhận** (giai đoạn 2).

| Cách làm | Hậu quả |
|---|---|
| Ảnh ngang (`w > h`) resize theo chiều rộng, còn lại theo chiều cao | Ảnh ngang gần vuông, ví dụ 2000×1900 vào khung 1600×1200, ra **1600×1520, vượt khung** |
| Chỉ giữ tỉ lệ (`aspectRatio()`), không chặn phóng to (`upsize()`) | Ảnh nhỏ bị **phóng to**: 300×200 → 640×427. Mờ và nặng hơn |
| Resize bản nhỏ từ bản lớn đã resize (dây chuyền) | Lấy mẫu hai lần, giảm chất lượng |
| Luôn lưu `.jpg` mà không đặt màu nền | PNG trong suốt có thể ra **nền đen** (tùy driver) |
| Quality mặc định 100 | File rất nặng mà mắt thường không thấy khác |
| Chọn driver theo extension đang có (imagick hoặc gd) | **Kết quả khác nhau giữa các máy** |
| Watermark: scale logo riêng theo từng chiều rồi `fit()` (crop) | Logo **méo hoặc bị cắt** khi ảnh không phải 4:3; vị trí logo đổi theo tỉ lệ ảnh |
| Watermark ghi đè ảnh gốc khi không chỉ định output | Mất ảnh gốc |

### 3.2. Hành vi đích của imgfit (đưa vào `docs/behavior.md`)

| Quy tắc | imgfit | Đã có? |
|---|---|---|
| Fit trong khung W×H, giữ tỉ lệ, **cả hai chiều** đều ≤ khung | `mode: fit` | ✓ |
| Không phóng to ảnh nhỏ (mặc định) | `smallInput: keep` / `upscale: false` | ✓ |
| **Bỏ qua preset khi ảnh nhỏ hơn khung cả hai chiều** | `smallInput: "skip"`, trả trạng thái `skipped` cùng lý do trong report | ✗ **thêm** |
| Xoay theo EXIF, rồi xóa tag orientation | auto-orient | ✓ |
| Trong suốt → JPG: làm phẳng trên nền **trắng**, kèm cảnh báo `W_ALPHA_FLATTENED` | `background` | ✓ |
| Giữ định dạng nếu nằm trong whitelist, ngược lại JPG | `format: { keep: ["png","webp"], fallback: "jpg" }` | ✗ **thêm** (hiện `keep` báo lỗi khi không giữ được) |
| JPEG progressive | `jpeg.progressive: true` (mặc định bật) | ✗ **thêm** |
| Quality mặc định 80 cho JPG (giống imgproxy) | `quality` | Đang là 85, **đổi thành 80** |
| Bỏ metadata, chuyển sRGB | `stripMetadata` | ✓ |
| Sharpen nhẹ sau khi giảm cỡ | `sharpen` | ✓ (tùy chọn). Quyết định bật hay tắt mặc định dựa trên so sánh ảnh ở giai đoạn 2 |
| Mỗi output resize **từ ảnh gốc**, không dây chuyền | engine | ✓ |
| Watermark scale đều hai chiều, không crop | mục 6.3 | ✗ **thêm** |
| Không bao giờ ghi đè ảnh gốc | engine (`E_OUTPUT_SAME_AS_SOURCE`) | ✓ |
| Kết quả giống nhau trên mọi máy (một engine libvips) | sharp | ✓ |
| Xuất WebP hoặc AVIF theo từng preset (thường nhẹ hơn JPG 25–35% ở chất lượng tương đương) | `format: "webp"` / `"avif"` | ✓ engine đã có. Chọn định dạng mặc định cho preset dựa trên so sánh ở giai đoạn 2 |
| **Không để ảnh ra nặng hơn ảnh vào:** nếu output cùng định dạng, cùng kích thước với input mà lại nặng hơn, thì dùng bản gốc, kèm cảnh báo `W_OUTPUT_LARGER`. Chỉ dùng bản gốc khi preset **không gắn watermark**, bản gốc không có metadata cần xóa (EXIF/GPS) và orientation = 1; ngược lại giữ output đã encode và vẫn ghi cảnh báo | `keepSmallerSource: true` (mặc định bật) | ✗ **thêm** |
| **Tên file có hash nội dung:** cùng một ảnh ra luôn cùng một key | placeholder `{hash}` trong template tên (16 ký tự hex đầu của SHA-256 nội dung file output cuối cùng). Lưu ý: nâng phiên bản imgfit/sharp có thể làm output đổi vài byte, nên hash đổi theo; chấp nhận được vì chỉ tốn một lần upload lại | ✗ **thêm** |

## 4. Ràng buộc runtime của imgfit

| Ràng buộc | Hệ quả |
|---|---|
| Node ≥ 20.15. Node từ bản 18 cần glibc ≥ 2.28; binary libvips dựng sẵn của sharp cần glibc ≥ 2.26 hoặc musl | **CLI không chạy được trên Linux cũ** (ví dụ CentOS 7), kể cả bản portable. Alpine (musl) chạy được |
| Mỗi lần gọi CLI phải khởi động Node + sharp | Nếu gọi đồng bộ trong request upload thì thời gian này cộng thẳng vào thời gian upload. Phải đo |
| Bên gọi có thể dùng PHP rất cũ | Ví dụ PHP hiện cần PHP 7.4+ (`proc_open` với mảng, `JSON_THROW_ON_ERROR`, `PHP_OS_FAMILY`) → viết lại cho PHP 5.6+ |

## 5. Cách bên ngoài gọi imgfit

### 5.1. Hai hướng

| Hướng | Mô tả | Được | Mất |
|---|---|---|---|
| **A. CLI** | `exec`/`resize --json` gọi bằng `proc_open`/`exec` | Đơn giản, không cần mạng | Bên gọi phải có Node mới (mục 4); mỗi lần gọi tốn thời gian khởi động process |
| **B. Service HTTP (container riêng)** ⭐ đề xuất | `imgfit serve` chạy trong Docker. Bên gọi dùng `curl`/`net/http`/`requests`. Đọc ghi ảnh qua volume chung, hoặc gửi file trực tiếp | Mọi ngôn ngữ, mọi server đều gọi được; process chạy sẵn nên nhanh; một nơi giữ preset và watermark | Thêm một container phải vận hành; cần xác thực và giới hạn |

**Đề xuất: làm cả hai**, B là cách tích hợp chính, A cho máy dev, script batch và UI.

### 5.2. API service đề xuất (để builder hoàn thiện chi tiết)

```
POST /v1/process              (JSON, file nằm trên volume chung)
  { "input": "upload/tmp/abc.jpg", "outputDir": "upload/tmp", "presets": ["L","LL"],
    "name": "{prefix}{name}.{ext}", "watermark": "brand" }
→ 200 { report JSON giống `imgfit exec`: từng output với status created|skipped|failed,
        kích thước, dung lượng, cảnh báo, lý do skip }

POST /v1/process (multipart)  khi không có volume chung: gửi file, nhận lại zip hoặc từng file
GET  /v1/health               version imgfit/sharp/libvips + danh sách preset
```

- **Xác thực:** bearer token cho từng bên gọi. Chỉ nghe trên mạng nội bộ. Không dùng cơ chế cookie/CSRF của UI local.
- **Giới hạn:** dung lượng file, số megapixel (`--max-pixels` đã có), timeout, số job song song (`p-limit` đã có).
- **Đường dẫn:** chỉ được đọc/ghi trong thư mục gốc được cấu hình (dùng lại `isInside`, `E_PATH_UNSAFE`).

### 5.3. Câu hỏi còn mở

| # | Câu hỏi | Ảnh hưởng | Chặn giai đoạn |
|---|---|---|---|
| **Q1** | Có làm chế độ service không? | ~300–600 dòng, thêm lệnh `serve` | 4 |
| **Q2** | Preset và watermark mẫu trong `init` lấy giá trị nào (đề xuất `L` 640×480, `LL` 1600×1200, `O` 2100×1400)? Định dạng mặc định là JPG hay WebP (chốt sau khi có số đo giai đoạn 2)? | Nội dung `imgfit.json` mẫu | Chỉ bước `init` ở giai đoạn 3 |
| **Q3** | Ví dụ PHP hỗ trợ từ bản nào (đề xuất 5.6+)? | Cách viết ví dụ PHP | 5 |

Giai đoạn 0–3 làm được ngay (Q2 chỉ cần khi viết `imgfit.json` mẫu cho `init`).

## 6. Thay đổi trong imgfit

### 6.1. Bỏ

| Bỏ | File | Lý do |
|---|---|---|
| Chế độ project: `run`, `check`, `watch`, rules, manifest, managed/cache/lock, crops/names/`{id}`, `--adopt`, profile | `src/commands/{run,check,watch}.ts`, `src/project/{manifest,decide,analysis,sources,verify,open}.ts`, `src/project/state/*`, `src/project/config/{find,resolve,samples}.ts` (rút gọn `load/types/validate` còn phần preset), `src/cli/commands/{run,check}.ts`, schema config phần `rules/roots/profile` | Phục vụ ảnh trong repo, không phục vụ resize trước khi upload |
| UI Project | `ui/src/ProjectView.vue`, `ConflictReview.vue`, `OutputDetail.vue`, `RenameMapper.vue`, `useProjectManifest.ts`, `useProjectWrite.ts`, `useNameMapping.ts`, `src/server/routes/{project,write}.ts` | Như trên |
| Hook pre-commit, CI mẫu | `examples/hooks/`, `examples/ci/` | Như trên. Bug B1–B5 (phụ lục A) mất theo |
| `--report-html` | `src/core/report-html.ts` + cờ | JSON là đủ |
| `--sea`, bản portable | `scripts/build-portable.mjs`, devDep `postject`, job `portable` | Vẫn cần glibc mới nên không giải quyết được máy cũ; Docker/service là cách triển khai chính |
| `blockMultiple`, ví dụ Unity | `src/image/*` (phần block), `examples/unity/` | Ngoài phạm vi ảnh web trước upload |
| `.imgfit-version` | `config/load.ts` | Gắn với chế độ project |
| Ví dụ Node | `examples/node/` | Bên dùng Node có thể gọi CLI hoặc service như các ngôn ngữ khác |

`init`: giữ bản rút gọn để tạo `imgfit.json` chỉ có `presets` + `watermarks` mẫu.

### 6.2. Giữ

Engine (`src/image`, `src/pipeline`, `src/io`, `src/core`); lệnh `resize`, `exec`, `info`, `capabilities`, `schema`; hợp đồng JSON (`result.schema.json`, `job.schema.json`, mã lỗi/cảnh báo, exit code); UI Quick (phụ, không mở rộng); Docker; ví dụ PHP (viết lại), shell, Python.

### 6.3. Thêm

| Thêm | Mô tả | Ước tính |
|---|---|---|
| `smallInput: "skip"` | Ảnh nhỏ hơn khung cả hai chiều → output `skipped`, kèm lý do; không lỗi | ~30 dòng + test |
| `format.keep` + `fallback` | Giữ định dạng nếu nằm trong danh sách, ngược lại chuyển sang `fallback` | ~40 dòng + test |
| JPEG progressive | `jpeg: { progressive: true }`, mặc định bật | ~10 dòng |
| Quality JPG mặc định 80 | Đổi `DEFAULT_QUALITY.jpg` | 1 dòng + cập nhật test |
| **Watermark** | Khai báo trong `imgfit.json`, gắn vào preset hoặc truyền theo job. Áp **sau resize**, logo scale **đều hai chiều** theo % chiều rộng output, 9 vị trí, offset tính theo % hoặc px của output, `minOutput` để bỏ qua ảnh nhỏ, `opacity` tùy chọn. Report ghi vị trí và kích thước logo, hoặc lý do bỏ qua | ~200 dòng + test |
| File preset dùng chung | `imgfit.json` chỉ còn `presets` + `watermarks`; `resize --preset L`, job `exec` và service đều đọc từ đây | rút gọn loader hiện có |
| WebP/AVIF theo preset | Engine đã encode được. Việc cần làm: cho `format` trong preset nhận `webp`/`avif`, thêm vào bộ so sánh giai đoạn 2, ghi kết quả vào `docs/behavior.md` | ~10 dòng + test |
| `keepSmallerSource` | So dung lượng output với input sau khi encode; đủ điều kiện (3.2) thì copy bản gốc thay cho output, report ghi `W_OUTPUT_LARGER` và dung lượng cả hai | ~40 dòng + test |
| Placeholder `{hash}` | Encode ra buffer/temp trước, tính SHA-256 nội dung output (dùng lại `src/core/fingerprint.ts`), rồi mới đặt tên và ghi atomic. Report trả tên cuối cùng | ~40 dòng + test |
| **Service HTTP** (nếu Q1 = có) | Mục 5.2 | ~300–600 dòng |
| `docs/behavior.md` + bộ ảnh mẫu | Mỗi quy tắc ở 3.2 có một ảnh mẫu và một test | ~20 ảnh mẫu, tự tạo bằng sharp |

Ví dụ `imgfit.json` (quality không ghi thì dùng mặc định 80):

```json
{
  "schemaVersion": 2,
  "presets": {
    "L":  { "size": [640, 480],   "mode": "fit", "smallInput": "keep", "format": { "keep": ["png", "webp"], "fallback": "jpg" }, "prefix": "L_" },
    "LL": { "size": [1600, 1200], "mode": "fit", "smallInput": "skip", "format": { "keep": ["png", "webp"], "fallback": "jpg" }, "prefix": "LL_" },
    "O":  { "size": [2100, 1400], "mode": "fit", "smallInput": "keep", "format": "jpg" }
  },
  "watermarks": {
    "brand": { "file": "brand/logo.png", "position": "bottom-left", "offset": ["1.5%", "5%"], "width": "15%", "minOutput": [640, 480] }
  }
}
```

### 6.4. Sửa

| Sửa | Chi tiết |
|---|---|
| Ví dụ PHP | Viết cho **PHP 5.6+**: chuỗi lệnh + `escapeshellarg` (CLI) và `curl` (service). Kèm một class mẫu `ImgfitClient` dùng được trong Laravel |
| Ví dụ Go | Thêm ví dụ gọi service |
| Test Windows 10 (B6) | Phụ lục A |
| CI và Node | Node 20 đã hết hỗ trợ (EOL 30/4/2026). CI mỗi push: ubuntu Node 22 + 24, windows Node 24, build Docker; ma trận đầy đủ khi push tag. Image Docker dùng Node 24 LTS. `engines` giữ `>=20.15` (sharp cần `>=20.9`) hoặc nâng lên `>=22`, quyết định khi làm |
| README, `docs/plan.md` | **Viết lại** theo mục đích mới. `docs/plan.md` cũ chuyển thành `docs/archive/plan-v1.md` |

### 6.5. Ước tính quy mô sau refactor

| | Trước | Sau |
|---|---:|---:|
| Code sản phẩm | ~7.520 | ~4.000–4.500 (gồm watermark và service) |
| Lệnh CLI | 9 | 6 (`resize`, `exec`, `info`, `capabilities`, `schema`, `ui`) + `serve` nếu có service + `init` rút gọn |
| Dependency runtime | 7 | 7 (giữ `express`, `multer` cho UI Quick và service; `fast-glob` vẫn dùng ở `src/io/inputs.ts`) |

## 7. Lộ trình

Branch `refactor/engine`. Mỗi bước là một commit nhỏ, và mỗi commit đều phải pass `npm run typecheck && npm test` (chạy từ PowerShell).

**Giai đoạn 0 — Baseline**
- [x] `typecheck`, `test`, `build`, `smoke`, `bench`; số dòng theo mục 2.

**Giai đoạn 1 — Cắt chế độ project (6.1)**
- [x] Thứ tự: `report-html`, SEA/portable → `watch` → UI Project + routes → `check` → `run` + `src/project` (giữ loader preset) → profile, `blockMultiple`, `.imgfit-version` → examples.
- [x] Trước mỗi lần xóa, grep mọi chỗ tham chiếu (src, ui, test, schema, README, CI, `package.json`).
- [x] Sửa B6.

**Giai đoạn 2 — Ảnh mẫu và tài liệu hành vi**
- [x] Tạo bộ ảnh mẫu: ngang, dọc, ngang gần vuông (2000×1900), nhỏ (300×200), PNG trong suốt, EXIF orientation 6/8, CMYK, rất lớn (> 50 MP), file giả đuôi.
- [x] Chạy **Intervention + imgproxy + imgfit** trên bộ mẫu (Intervention và imgproxy chạy bằng Docker, chỉ để so sánh), ghi kết quả vào `docs/behavior.md`. Đây là bước xác nhận các lỗi ở mục 3.1.
- [x] Với imgfit, so sánh **JPG q80, WebP, AVIF** trên cùng bộ mẫu: dung lượng, chất lượng mắt thường, thời gian encode. Thêm vài ảnh JPG nhỏ đã nén sẵn để kiểm tra trường hợp output nặng hơn input.
- [x] Viết test hành vi cho từng dòng của bảng 3.2.

**Giai đoạn 3 — Thêm tính năng (6.3, trừ service)**
- [x] `smallInput: skip` → `format.keep/fallback` → progressive → quality 80 → WebP/AVIF trong preset → `keepSmallerSource` → `{hash}` → file preset dùng chung → watermark.

**Giai đoạn 4 — Service (nếu Q1 = có)**
- [ ] Lệnh `imgfit serve`, xác thực token, giới hạn, health check; Dockerfile chạy service; test.
- [ ] Đo độ trễ mỗi request so với imgproxy và so với CLI.

**Giai đoạn 5 — Ví dụ tích hợp**
- [ ] Viết lại ví dụ PHP (`ImgfitClient`), thêm ví dụ Go, cập nhật ví dụ Python và shell.
- [ ] Test end-to-end cho các ví dụ: gọi CLI và service, kiểm tra report và file output.

**Giai đoạn 6 — Tài liệu và xác nhận**
- [ ] README mới (cài đặt, preset, gọi từ PHP/Go/Python, service, lưu ý ở mục 10), `docs/behavior.md`. *(Đã viết phần không phụ thuộc Q1/Q3; còn thêm service và ví dụ PHP/Go khi xong giai đoạn 4–5.)*
- [ ] `typecheck`, `test`, `build`, `smoke`, `bench` đều pass; bảng trước/sau.

## 8. Định nghĩa xong

1. `docs/behavior.md` mô tả mọi quy tắc xử lý, mỗi quy tắc có ảnh mẫu và test.
2. Trên bộ ảnh mẫu, imgfit không tệ hơn Intervention và imgproxy về kích thước, dung lượng và chất lượng.
3. Gọi được từ PHP 5.6+ mà không cần cài Node lên máy gọi (nếu Q1 = có).
4. Không còn code của chế độ project; test pass trên Windows 10/11, Linux, macOS.
5. Có số đo độ trễ của CLI, service và imgproxy.

## 9. Prompt giao cho Claude Code

```text
Thực hiện docs/plan.md trên branch refactor/engine.
- Theo đúng thứ tự giai đoạn ở mục 7. Mỗi bước một commit nhỏ, chạy typecheck + test (từ PowerShell).
- Giai đoạn 0–3 làm được ngay. Bước `init` cần câu trả lời Q2, giai đoạn 4 cần Q1, giai đoạn 5 cần Q3 (mục 5.3); dừng lại hỏi nếu chưa có.
- Giai đoạn 1: trước mỗi lần xóa, grep mọi chỗ tham chiếu; giữ đúng danh sách ở 6.2.
- Giai đoạn 2 phải làm trước giai đoạn 3: hành vi mới phải dựa trên kết quả so sánh ảnh thật.
- Không thêm tính năng ngoài mục 6.3. Không upload lên storage.
- Chỉ sửa code trong repo imgfit.
```

## 10. Lưu ý cho bên upload (R2/CDN)

imgfit không upload, nhưng cách đặt tên và chọn preset ảnh hưởng trực tiếp tới số request R2. Phần này đưa vào README.

### 10.1. R2 tính tiền thế nào

- R2 tính theo **số lần thao tác chạm tới bucket**. Class A gồm ghi, list, copy. Class B gồm đọc (GET, HEAD). Gói free có hạn mức Class A/B mỗi tháng (theo bảng giá hiện tại khoảng 1 triệu A và 10 triệu B, nên kiểm tra lại trên trang Cloudflare). Băng thông ra (egress) không tính tiền.
- **Request được CDN Cloudflare trả từ cache thì không chạm R2**, nên không tốn. Nguyên tắc: **để ảnh được cache, và đừng tạo URL mới cho cùng một ảnh** (không gắn `?t=time()` hay query ngẫu nhiên).
- Request trả về **404 vẫn tính** là một lần đọc, và 404 thường không được cache.
- `*.workers.dev` **không có cache ở edge**. Mỗi lượt xem ảnh qua đó là một lần gọi Worker cộng một lần đọc R2.

### 10.2. Áp dụng cho imgfit

- `imgfit.json` mẫu **luôn có preset `L`**, và README khuyên bên gọi luôn xin `L` kèm `O`, để danh sách/thumbnail không phải tải ảnh lớn. imgfit không tự thêm preset mà bên gọi không yêu cầu.
- Bên upload chịu trách nhiệm đặt `Cache-Control` (ví dụ `public, max-age=31536000, immutable`) và tên file duy nhất (đổi nội dung thì đổi tên).
- Dùng `{hash}` trong tên file (ví dụ `"{prefix}{hash}.{ext}"`): cùng một ảnh luôn ra cùng một key. Trước khi upload, bên gọi kiểm tra key đã có trong DB của mình chưa; có rồi thì bỏ qua, không tốn thêm một lần ghi (Class A) hay dung lượng lưu trữ. Không dùng `HeadObject` để kiểm tra, vì mỗi lần như vậy cũng là một request Class B.
- Ảnh nhẹ hơn thì không giảm số request, nhưng giảm dung lượng lưu trữ trên R2 và giúp trang tải nhanh hơn. Đó là lý do chọn WebP và có `keepSmallerSource` (mục 3.2).
- Report của imgfit trả về đúng tên file của từng preset (`L_…`, `LL_…`), để bên gọi lưu key chính xác thay vì phải đoán.
- UI Quick chỉ làm việc với file cục bộ, không đọc R2.

## Phụ lục A — Bug đã tìm thấy trong chế độ project (sẽ mất khi bỏ chế độ này)

Đã tái hiện bằng cách chạy thật trên commit `6984117`. Không cần sửa nếu làm theo 6.1. Ghi lại để biết vì sao không cần sửa.

| # | Bug | Tái hiện |
|---|---|---|
| B1 | `check` mode standard chỉ lọc theo đường dẫn nguồn (`check.ts:157`) | `check out/a.webp` với output hỏng → `ok`, total 0 |
| B2 | `check` không thấy ảnh lạ trong thư mục output (`output-only` chỉ duyệt `managed.json`) | `check --check-mode output-only out/stray.png` → `ok`, total 0 |
| B3 | Hook pre-commit đọc working tree thay vì nội dung staged | Stage ảnh hỏng, sửa lại working tree → hook exit 0 |
| B4 | Hook làm hỏng tên Unicode (`core.quotePath`) | Stage `out/ảnh.webp` hỏng → hook exit 0 |
| B5 | Hook bỏ qua file bị xóa; `npx imgfit` tự tải gói lạ khi chưa cài | Suy ra từ code |
| **B6** | **Test** tạo file `raw/CON.jpg`, Windows 10 không cho tạo | `resize.test.ts:261` fail trên Windows 10. **Vẫn phải sửa:** tạo nguồn tên thường, dùng `name: "CON.{ext}"` để kiểm tra logic đổi tên `_CON` |

## Phụ lục B — Kết quả thực hiện (16/11/2026)

Kết quả so sánh và quy tắc hành vi: [docs/behavior.md](behavior.md).

| | Trước (`6984117`) | Sau (giai đoạn 0–3) |
|---|---:|---:|
| `src` (dòng) | 6.100 | 4.599 (gồm watermark, `{hash}`, preset dùng chung, chưa có service) |
| `ui/src` (dòng) | 1.553 | 1.046 |
| `test` (dòng) | 1.397 | 1.584 |
| Test | 105 (Windows 11) | 120: unit, integration, behavior trên bộ ảnh mẫu; pass trên Windows 11 và Linux (Docker, Node 24) |
| Lệnh CLI | 9 | 7: `resize`, `exec`, `info`, `capabilities`, `schema`, `ui`, `init` (rút gọn) |
| `schemaVersion` | config 1, result 1 | config 2 (`presets` + `watermarks`), result 2 (bỏ `rule`, `unchanged/adopted/pass/warn/fail`; thêm `watermark`) |

Ghi chú khi làm:

- `imgfit exec` luôn in JSON trên stdout, kể cả lỗi trước khi chạy (trước đây phải thêm `--json`, mà `exec` không nhận `--json`).
- `npm run build` dọn `dist/` trước (trước đây file của lệnh đã xóa vẫn nằm trong gói npm).
- Mã lỗi/cảnh báo mới: `W_SMALL_INPUT_SKIPPED`, `W_OUTPUT_LARGER`, `W_SAME_CONTENT_EXISTS`, `W_WATERMARK_SKIPPED`. Đã bỏ các mã của chế độ project.
- Quy ước tên với `{hash}` khi key đã tồn tại: không ghi lại, status `skipped` + `W_SAME_CONTENT_EXISTS`, `destination` vẫn là tên cuối cùng.
- Bộ ảnh mẫu là ảnh tổng hợp. Tỉ lệ dung lượng WebP/AVIF so với JPG trên ảnh chụp thật có thể khác; nên chạy lại `scripts/compare/compare.mjs` với ảnh thật trước khi chốt định dạng mặc định (Q2).
- Ví dụ Go (giai đoạn 5) mâu thuẫn với yêu cầu trước đây "bỏ ví dụ Go"; cần xác nhận khi trả lời Q3.
