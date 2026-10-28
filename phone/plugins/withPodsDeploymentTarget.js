// Xcode 27 refuses to build pods that target iOS older than 15. Three pods
// the Mentra Bluetooth SDK pulls in (SwiftProtobuf, SWCompression,
// BitByteData) still say 11.0, so the build fails with "The iOS deployment
// target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 11.0". This raises each pod
// to the app's own minimum after `pod install`.

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MIN = '15.5';
const MARK = '# withPodsDeploymentTarget';
const SNIPPET = `
    ${MARK}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build|
        if build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${MIN}
          build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN}'
        end
      end
    end
`;

module.exports = function withPodsDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(file, 'utf8');
      if (!podfile.includes(MARK)) {
        // After react_native_post_install, so later steps keep it; else first thing in post_install.
        const afterRn = /react_native_post_install\([\s\S]*?\n\s*\)\n/;
        podfile = afterRn.test(podfile)
          ? podfile.replace(afterRn, (m) => m + SNIPPET)
          : podfile.replace(/post_install do \|installer\|\n/, (m) => m + SNIPPET);
        fs.writeFileSync(file, podfile);
      }
      return cfg;
    },
  ]);
};
