!include nsDialogs.nsh

XPStyle on

!macro customUnInstall
; Uninstall process execution
    ${ifNot} ${isUpdated}
        # Check if the folder exists before showing the message box
        IfFileExists "$PROFILE\jan" folder_exists folder_not_exists
        
        folder_exists:
            # If folder exists, show message box asking if user wants to delete it
            MessageBox MB_OKCANCEL "Do you also want to delete the DEFAULT Jan data folder at $PROFILE\jan?" IDOK label_ok  IDCANCEL  label_cancel
            Goto done

        folder_not_exists:
            # If folder does not exist, skip the message box
            Goto done

        label_ok:
            # Delete user data folder
            RMDir /r $PROFILE\jan
            Goto done

        label_cancel:
            Goto done

        done:
    ${endIf}
!macroend
