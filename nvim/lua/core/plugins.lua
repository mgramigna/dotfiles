local execute = vim.api.nvim_command
local fn = vim.fn

local install_path = fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'

if fn.empty(fn.glob(install_path)) > 0 then
  fn.system({'git', 'clone', 'https://github.com/wbthomason/packer.nvim', install_path})
  execute 'packadd packer.nvim'
end

local packer = require('packer')
return packer.startup(function(use)
  -- Packer
  use 'wbthomason/packer.nvim'

  -- LSP
  use { 'neovim/nvim-lspconfig', config = require('plugin.lspconfig'), requires = {
      { 'williamboman/nvim-lsp-installer' }
    }
  }

  use { 'hrsh7th/nvim-cmp', config = require('plugin.nvim-cmp'), requires = {
      { 'hrsh7th/cmp-nvim-lsp' },
      { 'hrsh7th/cmp-buffer' },
      { 'hrsh7th/cmp-vsnip' },
      { 'hrsh7th/vim-vsnip' },
      { 'onsails/lspkind-nvim' },
    }
  }

  use { 'RishabhRD/nvim-lsputils', config = require('plugin.lsputils'), requires = {
      { 'RishabhRD/popfix' },
    }
  }

  -- Formatting
  use { 'mhartington/formatter.nvim', config = require('plugin.formatter') }

  -- Syntax
  use { 'nvim-treesitter/nvim-treesitter', run = ":TSUpdate", config = require('plugin.treesitter') }

  -- Appearance
  use 'kyazdani42/nvim-web-devicons'
  use { 'hoob3rt/lualine.nvim', config = require('plugin.lualine') }
  use { 'dracula/vim', as = 'dracula' }

  -- Editing Keybinds
  use 'b3nj5m1n/kommentary'
  use 'tpope/vim-surround'

  -- Files
  use { 'nvim-telescope/telescope.nvim', config = require('plugin.telescope'), requires = {
      "nvim-lua/popup.nvim",
      "nvim-lua/plenary.nvim",
    }
  }

  use { 'kyazdani42/nvim-tree.lua', config = require('plugin.nvim-tree') }

  -- Git
  use 'tpope/vim-fugitive'
  use { 'lewis6991/gitsigns.nvim', requires = { 'nvim-lua/plenary.nvim' }, config = require('plugin.gitsigns') }

  -- Markdown
  use {"npxbr/glow.nvim", run = "GlowInstall" }

  -- Jest execution
  use { 'David-Kunz/jester', config = require('plugin.jester') }
end)

