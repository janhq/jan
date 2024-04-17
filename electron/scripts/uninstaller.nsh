!include nsDialogs.nsh

XPStyle on

!macro customUnInstall
; Uninstall process execution
    ${ifNot} ${isUpdated}
        # If you tick Delete fixed folder
        MessageBox MB_OKCANCEL "Do you also want to delete the DEFAULT Jan data folder at $PROFILE\jan?" IDOK label_ok  IDCANCEL  label_cancel
        label_ok:
            # Delete user data folder
            RMDir /r $PROFILE\jan
            Goto end
        label_cancel:
            Goto end
        end:
    ${endIf}
!macroend