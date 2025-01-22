## Installation and Setup
```
bun i -g @bradymadden97/freephite-cli

# Get a Github Access Token from https://github.com/settings/tokens
# Use a "classic token" for now (7/14/2023)
fp auth-fp -t <YOUR_GITHUB_ACCESS_TOKEN>
```

## Update the CLI
```
bun i -g @bradymadden97/freephite-cli@latest
```


## (WIP) Develop Locally
```
git clone https://github.com/bradymadden97/freephite
cd freephite
bun i

# Install turbo
npm i -g turbo
turbo build

# To test your local build
node ~path/to/freephite/dist/src/index.js
```

## (WIP) Install locally
```
nvm use
yarn install
yarn build
yarn build-pkg
npm link
```

Reinstall with
```
rm /Users/elliott/.nvm/versions/node/v18.18.2/bin/pc; rm /Users/elliott/.nvm/versions/node/v18.18.2/bin/pancake; yarn build-dev && yarn build-pkg && npm link
```

## Publish
```
cd ~path/to/freephite/
npm publish
```
