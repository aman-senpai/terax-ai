# xterax-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _xterax_user_zdotdir="${XTERAX_USER_ZDOTDIR:-$HOME}"
  [ -f "$_xterax_user_zdotdir/.zprofile" ] && source "$_xterax_user_zdotdir/.zprofile"
  unset _xterax_user_zdotdir
}
:
