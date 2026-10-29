# Releases

Update the version and add a Changesets entry, then tag and push the release:

```sh
git tag v1.0.0-beta.1 && git push origin v1.0.0-beta.1
```

The release workflow builds desktop installers and publishes them to the GitHub
releases for `devwaheed/orch`. Tags with a prerelease part publish beta builds;
stable tags publish the latest channel.

GitHub Actions secrets enable signing and notarisation:

- macOS: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

The app checks GitHub Releases at startup and every six hours. It selects the
beta or latest update channel from its packaged version and installs an update
on the next restart, when no job is active.
