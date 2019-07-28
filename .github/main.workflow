workflow "Unit Test" {
  on = "push"
  resolves = ["npm run ci"]
}

action "npm install" {
  uses = "actions/npm@master"
  args = "install"
}

action "npm run ci" {
  uses = "actions/npm@master"
  args = "run ci"
  needs = ["npm install"]
}
