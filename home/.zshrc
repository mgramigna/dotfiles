export PATH=$HOME/.local/scripts:$PATH
export PATH=$HOME/.local/bin:$PATH
export PATH=$HOME/.local/share/bob/nvim-bin:$PATH

export ZSH="$HOME/.oh-my-zsh"
export FZF_DEFAULT_OPTS=" \
--color=bg+:#363a4f,bg:#24273a,spinner:#f4dbd6,hl:#ed8796 \
--color=fg:#cad3f5,header:#ed8796,info:#c6a0f6,pointer:#f4dbd6 \
--color=marker:#f4dbd6,fg+:#cad3f5,prompt:#c6a0f6,hl+:#ed8796"
export EDITOR="nvim"

# Aliases
alias vim="nvim"
alias vi="/usr/bin/vim"
alias t="tmux-sessionizer"
alias cat="bat"
alias lg="lazygit"
alias oc="opencode"
alias wts="wt switch"
alias wtc="wt switch --create"
alias wtr="wt remove"

ZSH_THEME=""
plugins=(git zsh-syntax-highlighting zsh-autosuggestions tmux)
if [ -s "$ZSH/oh-my-zsh.sh" ]; then
  source $ZSH/oh-my-zsh.sh
fi

if command -v starship >/dev/null 2>&1; then eval "$(starship init zsh)"; fi
if command -v fzf >/dev/null 2>&1; then eval "$(fzf --zsh)"; fi
if command -v zoxide >/dev/null 2>&1; then eval "$(zoxide init zsh)"; fi
if command -v atuin >/dev/null 2>&1; then eval "$(atuin init zsh --disable-up-arrow)"; fi

if [ -s "$HOME/.cargo/env" ]; then
  . "$HOME/.cargo/env"
fi

if command -v wt >/dev/null 2>&1; then eval "$(command wt config shell init zsh)"; fi

if [ -s "$HOME/.zshrc.local" ]; then
  source "$HOME/.zshrc.local"
fi

if [ -s "$HOME/.atuin/bin/env" ]; then
  . "$HOME/.atuin/bin/env"
fi

