set shell := ["bash", "-cu"]

# Show available recipes.
default:
  just --list

# Remove build artifacts.
clean:
  npm run clean

# Run typecheck, lint, and tests.
check:
  npm run check
  npm test

# Compile the project into dist/.
build:
  npm run build

# Clean and rebuild the project.
rebuild: clean build

# Preview the npm package contents without creating a tarball.
pack-dry-run:
  npm pack --dry-run

# Build and create a local npm tarball.
pack: clean build
  npm pack

# Build and run the local CLI with custom arguments.
run *args: build
  node dist/main.js {{args}}

# Create a config file through the CLI bootstrap command.
init *args: build
  node dist/main.js init {{args}}

# Install the package globally from the local checkout.
install-global: clean check build
  npm install -g .

# Remove the globally installed package.
uninstall-global:
  npm uninstall -g @tschmz/imp
