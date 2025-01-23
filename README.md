## (WIP) Develop Locally
```
git clone git@github.com:evforde/pancake-cli.git
cd pancake-cli
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

# Get a Github Access Token from https://github.com/settings/tokens
# Use a "classic token" for now (7/14/2023)
pc auth-fp -t <YOUR_GITHUB_ACCESS_TOKEN>
```

Reinstall with
```
rm ~/.nvm/versions/node/v18.18.2/bin/pc; rm /Users/elliott/.nvm/versions/node/v18.18.2/bin/pancake; yarn build-dev && yarn build && npm link
```

## Publish
```
cd ~path/to/freephite/
npm publish
```
