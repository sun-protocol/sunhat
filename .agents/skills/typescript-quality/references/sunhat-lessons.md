# Sunhat commits and lessons

Source: [sun-protocol/sunhat](https://github.com/sun-protocol/sunhat), historically extracted from branch `restore/sunhat-2` at baseline `87f792bc26506ee646cd457875414bb32ccf533d`. The table covers 18 recent commits up to that baseline. Some commits had not been pushed when this record was written, so GitHub availability was not treated as verified evidence.

Use this file to trace or revise the skill, not as a configuration template for other TypeScript projects. Node 20.11, Hardhat 2, specific compiler versions, directory counts, and framework choices are source-project constraints rather than universal requirements.

| Commit    | Actual change                                                          | Reusable engineering judgment                                                                                                            |
| --------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `0e93ca4` | Adopt a TOML library and native initialization argument parsing        | Use platform APIs that fit the runtime baseline for standard arguments and mature parsers for format syntax                              |
| `5ff4d6b` | Separate TOML syntax from binding validation                           | Parsed output still needs business rules; library upgrades must not silently broaden product support                                     |
| `ad937c1` | Reorganize Foundry initialization, installation, and template settings | Keep installation, execution, and configuration ownership distinct rather than duplicating settings in commands                          |
| `d424313` | Rewrite the overview and QuickStart                                    | Installation instructions, global and local CLI use, compatibility, and command examples must match real behavior                        |
| `3f1938e` | Check parent paths before writing                                      | Validate the complete write plan and protect existing content so predictable conflicts do not leave partial projects                     |
| `96e1bb3` | Validate framework JSON input                                          | Reject `null`, arrays, and invalid field types at input boundaries; verify module-resolution failures on the minimum Node version        |
| `1804eef` | Distinguish write errors from conflicts                                | Do not classify every filesystem failure as an overwrite conflict; retain paths, error codes, and causes                                 |
| `e4bad10` | Clean up process listeners and correct signal exit status              | Release listeners on startup failure and completion without disturbing the caller's state                                                |
| `94924ba` | Separate toolchain services from command handlers                      | Shared installation logic should not live in another command module; help paths should return normally                                   |
| `917cab0` | Strengthen TypeScript, ESLint, and error handling                      | Apply rules in valid type contexts, preserve causes, and account for runtime and template requirements                                   |
| `100325a` | Preserve installation results and report cleanup failures              | Cleanup must not replace the primary error or prevent other cleanup attempts; report committed state and leftovers separately            |
| `f22b006` | Validate existing projects before adoption                             | Check real files and directories before writing, including overwrite protection for broken binding links                                 |
| `c4a746b` | Isolate CLI tests and bound child processes                            | Resolve resources relative to modules, clean up owned temporary projects, and avoid incidental cwd or unlimited waits                    |
| `1f1ffa5` | Generate portable dependencies from package metadata                   | Keep name and version in one source, generate registry dependencies by default, and make local integration paths explicit                |
| `70a2365` | Validate installation from a real tgz                                  | Verify packaging, isolated installation, executable entry points, and all four original templates from clean artifacts                   |
| `1338561` | Separate initialization planning from file writes                      | Keep plans independently inspectable while protecting execution against later conflicts                                                  |
| `df92e15` | Inject installation I/O and remove source-rewriting fixtures           | Replace download and extraction boundaries, control checksums through temporary configuration, and retain real filesystem recovery tests |
| `87f792b` | Consolidate control layers and single-function files                   | A useful responsibility boundary is not the same as one function per file; related logic can share a module and remain testable          |

## Checking the evidence

Use `git show` in a Sunhat checkout containing this history, for example:

```bash
git show 96e1bb3 -- src test
git show 70a2365 -- package.json test/package.test.js .github/workflows/ci.yml
git show 87f792b -- src test bin
```

Paths may have moved in later refactors; use the file tree of the commit being inspected. Routine use of this skill does not require reading these historical commits.
