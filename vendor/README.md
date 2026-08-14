# vendor/

Third-party libraries served from this origin instead of a CDN.

## Why not a CDN with `integrity=`?

Subresource Integrity was the first choice — pin the bytes, let the CDN serve
them. It does not work for the main file here. jsDelivr **minifies on the fly**:
`chart.js@4.4.4/dist/chart.umd.min.js` does not exist in the published npm
package, so the bytes jsDelivr serves are its own minifier's output. There is no
hash anybody can compute offline and no guarantee it stays byte-stable, and a
wrong SRI hash does not degrade — it blocks the script and the page renders no
charts at all.

Self-hosting removes the question. These four scripts used to execute with full
access to the origin that holds the Supabase session **and** the GitHub PAT, so
a compromised or hijacked CDN had the same blast radius as a stored-XSS bug.
Now there is no third-party origin in the load path.

## Provenance

Every file was extracted verbatim from the official npm tarball — no
re-minification, no edits — via `npm pack <name>@<version>`.

| File | Package | Tarball path | SHA-384 (base64) |
|---|---|---|---|
| `chart.umd-4.4.4.js` | `chart.js@4.4.4` | `package/dist/chart.umd.js` | `G436+Z2nlA8+PNoeRvWdxKbvOf8E/y+lYxqht2iBwNHTQDV5CJr3+AGVj8fGZi5t` |
| `chartjs-adapter-date-fns.bundle-3.0.0.min.js` | `chartjs-adapter-date-fns@3.0.0` | `package/dist/chartjs-adapter-date-fns.bundle.min.js` | `cVMg8E3QFwTvGCDuK+ET4PD341jF3W8nO1auiXfuZNQkzbUUiBGLsIQUE+b1mxws` |
| `chartjs-plugin-zoom-2.0.1.min.js` | `chartjs-plugin-zoom@2.0.1` | `package/dist/chartjs-plugin-zoom.min.js` | `zPzbVRXfR492Sd5D+HydTYCxxgHAfgVO8KERbLlpeH5unsmbAEXrscGUUqLZG9BM` |

`chart.umd.js` is the package's own UMD build and is **already minified** —
205 KB raw, 68 KB gzipped, which is within a few hundred bytes of what jsDelivr
was serving. Nothing was gained by re-minifying it (esbuild produced a slightly
*larger* file), so it ships exactly as published.

## Verifying, or upgrading

```sh
npm pack chart.js@4.4.4
tar -xzOf chart.js-4.4.4.tgz package/dist/chart.umd.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

That must print the hash in the table. To upgrade: bump the version, re-extract,
rename with the new version in the filename, update the `<script>` tags in
`dashboard.html`, and update this table.

## Still on a CDN

`settings.html` loads SheetJS from `cdn.sheetjs.com`. SheetJS is no longer
published to npm at this version, so its bytes could not be obtained or verified
here — it keeps its CDN tag, and it is the one remaining third-party script with
access to this origin. It is only needed for Excel import.
