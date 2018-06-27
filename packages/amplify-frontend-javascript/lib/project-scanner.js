const fs = require('fs-extra'); 
const path = require('path'); 
const constants = require('./constants');

function run(projectPath){
    let score = constants.ProjectScanBaseScore; 
    let settingsFilePath = path.join(projectPath, 'settings.gradle')
    let buildFilePath = path.join(projectPath, 'build.gradle')
    if(fs.existsSync(settingsFilePath) && fs.existsSync(buildFilePath)){
        score = constants.ProjectScanMaxScore; 
    }
    return score;
}
  
module.exports = {
    run
};
  