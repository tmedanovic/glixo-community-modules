# Accessible theme and controls — typescript contribution guest

This language project implements the manifest action save-preferences. The browser panel is the separately packaged static asset at ui/index.html, mapped from the shared source in the public reference index. The guest receives a host-stamped glixo:contribution/contribution@1.0.0 envelope with kind actions and persists the validated preference under the declared accessible-theme/preferences/ extension-storage prefix.

Build the contribution component with the pinned contribution-typescript-v1 recipe. This verifies the guest artifact only; it does not install the package into Glixo or prove browser/native host acceptance.
