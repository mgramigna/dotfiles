call plug#begin('~/.config/nvim/plugins/bundle')
" LSP
Plug 'neovim/nvim-lspconfig'
Plug 'glepnir/lspsaga.nvim'
Plug 'hrsh7th/nvim-compe'

" Syntax
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" Appearance
Plug 'kyazdani42/nvim-web-devicons'
Plug 'dracula/vim', { 'as': 'dracula' }
Plug 'hoob3rt/lualine.nvim'

" Editing Keybinds
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-surround'

" Files
Plug 'nvim-lua/popup.nvim'
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'
Plug 'kyazdani42/nvim-tree.lua'
call plug#end()
